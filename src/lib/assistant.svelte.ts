/**
 * AI assistant: builds prompts from repository state and sends them to the
 * provider chosen in Settings → AI (see src-tauri/src/ai.rs).
 */
import { ai, git, type ChatMessage, type Commit } from "./api";
import { settings, AI_PROVIDERS } from "./settings.svelte";
import { app, type RepoTab } from "./state.svelte";
import { ui } from "./ui.svelte";
import { cleanCommitMessage } from "./commitMessage";

/** Diffs bigger than this are cut, and the model is told what was left out. */
const MAX_DIFF_CHARS = 150_000;
/**
 * Commit messages need far less: a smaller diff keeps generation quick, and
 * the full file list (sent separately) still shows everything that changed.
 */
const MAX_COMMIT_DIFF_CHARS = 30_000;
/** Hard cap on body bullets, in case the model ignores the prompt. */
const MAX_COMMIT_BULLETS = 4;

const SYSTEM = `You are the assistant built into Orbe, a desktop Git client. You help a developer understand and manage their Git repository: explain changes and commits, write commit messages and pull request descriptions, review diffs, and suggest Git commands.

Be concise and concrete, and refer to files by path. Use Markdown. Put commands in fenced code blocks. Prefer safe commands, and clearly warn before anything that can lose work (reset --hard, push --force, clean, deleting branches).`;

const COMMIT_SYSTEM = `You write short, well-structured Git commit messages. Your reply is pasted directly into the commit message box, so it must contain the commit message and nothing else.

Format, exactly:
- Line 1: the summary, ideally under 60 characters (never over 72). If the recent commit subjects show a clear convention (for example Conventional Commits like "feat: ..." or a ticket prefix), follow it; otherwise use the imperative mood ("Add", "Fix", "Refactor"). No trailing period.
- Line 2: empty.
- Then 1 to ${MAX_COMMIT_BULLETS} "- " bullets, one line each (under 90 characters), most important first.

Be brief:
- Describe intent and effect (what changed for the user or the code, and why), not a file-by-file tour.
- Group related edits into one bullet. Skip trivial details: formatting, imports, renames, lockfiles, generated files.
- For a small, single-purpose change, write just the summary line with no body.

Never include a git command (such as git commit -m), code fences, quotes around the message, Markdown headings or bold, or any text before or after the message. Do not run any commands or read any files; everything you need is below.`;
export const aiReady = () => settings.value.ai.provider !== "none";

export function providerLabel(): string {
  const p = settings.value.ai.provider;
  if (p === "none") return "Not set up";
  const model = settings.aiConfig.model;
  return model ? `${AI_PROVIDERS[p].label} · ${model}` : AI_PROVIDERS[p].label;
}

function clip(text: string, label: string, max = MAX_DIFF_CHARS): string {
  if (text.length <= max) return text;
  const rest = text.length - max;
  return `${text.slice(0, max)}\n\n[${label} truncated: ${rest.toLocaleString()} more characters were not included]`;
}

function repoContext(tab: RepoTab): string {
  const lines: string[] = [];
  const head = tab.headBranch;
  lines.push(`Repository: ${tab.repo?.name ?? "unknown"}`);
  if (head) {
    const track = head.upstream ? ` (tracks ${head.upstream}; ${head.ahead} ahead, ${head.behind} behind)` : " (no upstream)";
    lines.push(`Current branch: ${head.name}${track}`);
  } else {
    lines.push(`Current branch: ${tab.repo?.head ?? "detached HEAD"}`);
  }
  const locals = tab.branches.filter((b) => b.kind === "local").map((b) => b.name);
  if (locals.length) lines.push(`Local branches: ${locals.slice(0, 30).join(", ")}${locals.length > 30 ? ", …" : ""}`);
  if (tab.status.length) {
    lines.push(`Uncommitted changes (${tab.status.length}):`);
    for (const s of tab.status.slice(0, 60)) lines.push(`- ${s.staged ? "staged" : "unstaged"} ${s.status}: ${s.path}`);
    if (tab.status.length > 60) lines.push(`- … and ${tab.status.length - 60} more`);
  } else {
    lines.push("Working tree: clean");
  }
  lines.push("Recent commits:");
  for (const c of tab.commits.slice(0, 12)) lines.push(`- ${c.shortHash} ${c.subject} (${c.author})`);
  return lines.join("\n");
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Point the user at Settings → AI when no provider is configured. */
function ensureReady(): boolean {
  if (aiReady()) return true;
  ui.settingsPage = "ai";
  app.settingsOpen = true;
  app.toast("info", "Set up the AI assistant", "Choose a provider to enable AI features.");
  return false;
}

function complete(tab: RepoTab, system: string, messages: ChatMessage[], effort: "low" | "medium") {
  return ai.complete(settings.aiConfig, system, messages, effort, tab.repo?.path ?? null);
}

/** Draft a commit message for the staged changes. */
export async function generateCommitMessage(tab: RepoTab): Promise<{ summary: string; description: string } | null> {
  if (!ensureReady() || !tab.repo) return null;
  try {
    // Describe what Commit will actually include: the staged files, or everything when nothing is staged.
    let diff = await git.stagedDiff(tab.repo.path);
    let label = "Staged changes";
    let files = tab.status.filter((s) => s.staged);
    if (!diff.trim()) {
      diff = await git.workingDiff(tab.repo.path);
      label = "Changes to commit";
      files = tab.status;
    }
    if (!diff.trim()) {
      app.toast("info", "Nothing to commit", "Your working tree is clean.");
      return null;
    }
    const recent = tab.commits.slice(0, 15).map((c) => `- ${c.subject}`).join("\n") || "(no commits yet)";
    const fileList = [...new Set(files.map((f) => `- ${f.status}: ${f.path}`))].slice(0, 80).join("\n");
    const prompt = `Recent commit subjects in this repository:\n${recent}\n\nFiles in this commit:\n${fileList}\n\n${label}:\n${clip(diff, "Diff", MAX_COMMIT_DIFF_CHARS)}`;
    const raw = await complete(tab, COMMIT_SYSTEM, [{ role: "user", content: prompt }], "low");
    const message = cleanCommitMessage(raw, MAX_COMMIT_BULLETS);
    if (!message.summary) throw new Error("The model didn't return a commit message.");
    return message;
  } catch (e) {
    app.toast("error", "Couldn't generate a message", errorText(e));
    return null;
  }
}

/** Send a message in the assistant panel. `attach` is extra context the user doesn't see. */
export async function send(tab: RepoTab, text: string, attach?: string) {
  if (!ensureReady() || tab.chatBusy) return;
  ui.assistant = true;
  // Replies land in the conversation that asked, even if the user switches away meanwhile.
  const chat = tab.ensureChat(text);
  chat.turns.push({ role: "user", content: attach ? `${text}\n\n${attach}` : text, display: text });
  chat.updatedAt = Date.now();
  tab.busyChats.add(chat.id);
  tab.saveChats();
  try {
    const history = chat.turns.filter((t) => !t.error).map(({ role, content }) => ({ role, content }));
    const system = `${SYSTEM}\n\nCurrent state of the repository:\n${repoContext(tab)}`;
    const reply = await complete(tab, system, history, "medium");
    chat.turns.push({ role: "assistant", content: reply.trim() });
  } catch (e) {
    chat.turns.push({ role: "assistant", content: errorText(e), error: true });
  } finally {
    chat.updatedAt = Date.now();
    tab.busyChats.delete(chat.id);
    tab.saveChats();
  }
}

async function withDiff(tab: RepoTab, load: () => Promise<string>, text: string, label: string, empty: string) {
  if (!ensureReady() || !tab.repo) return;
  ui.assistant = true;
  try {
    const diff = await load();
    if (!diff.trim()) {
      app.toast("info", empty);
      return;
    }
    await send(tab, text, `${label}:\n${clip(diff, label)}`);
  } catch (e) {
    app.toast("error", "Couldn't read the changes", errorText(e));
  }
}

export function summarizeChanges(tab: RepoTab) {
  return withDiff(
    tab,
    () => git.workingDiff(tab.repo!.path),
    "Summarize my uncommitted changes: what they do, and whether they belong in one commit or several.",
    "Uncommitted changes",
    "No uncommitted changes",
  );
}

export function reviewStaged(tab: RepoTab) {
  return withDiff(
    tab,
    () => git.stagedDiff(tab.repo!.path),
    "Review my staged changes. Point out bugs, risky edits and anything I may have forgotten, referencing files and lines.",
    "Staged changes",
    "Nothing staged to review",
  );
}

export function explainCommit(tab: RepoTab, commit: Commit) {
  return withDiff(
    tab,
    () => git.commitPatch(tab.repo!.path, commit.hash),
    `Explain commit ${commit.shortHash} ("${commit.subject}"): what it changes and why it likely matters.`,
    "Commit",
    "This commit has no changes",
  );
}

export function newChat(tab: RepoTab) {
  tab.newChat();
}

/**
 * "Resolve all with AI" for a whole merge/rebase: runs the conflict resolver
 * on every conflicted text file and parks the answers on the tab. Each file's
 * conflict view picks them up when opened, so everything is reviewed (and
 * saved with Mark resolved) file by file. Nothing is written here.
 */
import { confirmAction, git } from "./api";
import { buildResult, hasMarkers, parseConflicts, type Choice } from "./conflicts";
import { resolveWithAi } from "./conflictAi";
import { aiReady } from "./assistant.svelte";
import { app, type RepoTab } from "./state.svelte";
import { ui } from "./ui.svelte";

/** Files sent to the provider at the same time. */
const PARALLEL = 2;

export async function resolveMergeWithAi(tab: RepoTab) {
  const repo = tab.repo;
  if (!repo || tab.aiResolving) return;
  if (!aiReady()) {
    ui.settingsPage = "ai";
    app.settingsOpen = true;
    app.toast("info", "Set up the AI assistant", "Choose a provider to resolve conflicts with AI.");
    return;
  }
  // Files the AI already settled completely are skipped; the rest are (re)asked.
  const done = new Set(readyAiFiles(tab));
  const paths = [...new Set(tab.status.filter((s) => s.status === "conflicted").map((s) => s.path))].filter((p) => !done.has(p));
  if (!paths.length) {
    if (done.size) app.toast("info", "Already resolved by AI", "Use Apply in the merge banner to save them, or review each file.");
    return;
  }

  tab.aiResolving = { done: 0, total: paths.length };
  let solved = 0;
  let left = 0;
  let skipped = 0;
  const failed: string[] = [];
  const queue = [...paths];

  async function one(path: string) {
    const [info, content] = await Promise.all([git.conflictInfo(repo!.path, path), git.readFile(repo!.path, path).catch(() => null)]);
    const text = content?.text;
    const parsed = text && !content!.binary && !content!.truncated ? parseConflicts(text) : null;
    // Deleted on one side, binary, or no markers: a whole-file choice the AI doesn't make.
    if (!text || !parsed || !parsed.conflicts.length) {
      skipped++;
      return;
    }
    const result = await resolveWithAi({
      path,
      parsed,
      targets: parsed.conflicts,
      oursName: info.oursLabel || "Current",
      theirsName: info.theirsLabel || "Incoming",
      rebasing: tab.operation === "rebase",
      cwd: repo!.path,
    });
    for (const o of result.values()) o.choice ? solved++ : left++;
    tab.aiConflictSuggestions = { ...tab.aiConflictSuggestions, [path]: { text, outcomes: [...result.entries()], rev: Date.now() + Math.random() } };
  }

  async function worker() {
    for (let path = queue.shift(); path; path = queue.shift()) {
      try {
        await one(path);
      } catch (e) {
        failed.push(`${path.split("/").pop()}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (tab.aiResolving) tab.aiResolving = { ...tab.aiResolving, done: tab.aiResolving.done + 1 };
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL, paths.length) }, worker));
  } finally {
    tab.aiResolving = null;
  }

  const files = Object.keys(tab.aiConflictSuggestions).filter((p) => paths.includes(p));
  if (files.length) {
    // Open the first file with suggestions so review starts right away.
    tab.view = "changes";
    const first = tab.status.find((s) => s.status === "conflicted" && files.includes(s.path));
    if (first) tab.selectedChange = first;
    const extra = [left && `${left} left for you`, skipped && `${skipped} file${skipped === 1 ? "" : "s"} need a whole-file choice`].filter(Boolean).join(" · ");
    app.toast(
      left || skipped ? "info" : "success",
      `AI resolved ${solved} conflict${solved === 1 ? "" : "s"} in ${files.length} file${files.length === 1 ? "" : "s"}`,
      `${extra ? `${extra}. ` : ""}Review each file, then Mark resolved.`,
    );
  } else if (!failed.length) {
    app.toast("info", "Nothing for the AI to resolve", "These files need a whole-file choice (deleted on one side, or binary).");
  }
  if (failed.length) app.toast("error", "Some files couldn't be resolved with AI", failed.slice(0, 3).join("\n"));
}

/** Files whose every conflict has an AI (or hand-picked) answer, ready to save as they are. */
export function readyAiFiles(tab: RepoTab): string[] {
  const conflicted = new Set(tab.status.filter((s) => s.status === "conflicted").map((s) => s.path));
  return Object.entries(tab.aiConflictSuggestions)
    .filter(([path, s]) => conflicted.has(path) && s.outcomes.length > 0 && s.outcomes.every(([, o]) => !!o.choice))
    .map(([path]) => path);
}

/**
 * The global step: save every file the AI resolved completely and mark it
 * resolved, in one go. Files with conflicts left (or changed since) are kept
 * for review.
 */
export async function applyAiSuggestions(tab: RepoTab) {
  const repo = tab.repo;
  if (!repo) return;
  const ready = readyAiFiles(tab);
  if (!ready.length) return;
  const conflicted = new Set(tab.status.filter((s) => s.status === "conflicted").map((s) => s.path));
  const pendingOthers = [...conflicted].filter((p) => !ready.includes(p)).length;
  const ok = await confirmAction(
    `Save the AI's resolution for ${ready.length} file${ready.length === 1 ? "" : "s"} and mark ${ready.length === 1 ? "it" : "them"} resolved?` +
      (pendingOthers ? `\n\n${pendingOthers} other file${pendingOthers === 1 ? " still needs" : "s still need"} you.` : "") +
      `\n\nYou can still check the result in History before continuing the ${tab.operation ?? "merge"}, or abort it.`,
    "Apply AI resolutions",
    "Apply",
  );
  if (!ok) return;

  const files: { path: string; content: string }[] = [];
  const changed: string[] = [];
  for (const path of ready) {
    const sug = tab.aiConflictSuggestions[path];
    const current = await git.readFile(repo.path, path).catch(() => null);
    // Edited outside Orbe since the AI looked at it: don't overwrite.
    if (!sug || current?.text !== sug.text) {
      changed.push(path);
      continue;
    }
    const parsed = parseConflicts(sug.text);
    if (!parsed) {
      changed.push(path);
      continue;
    }
    const choices = parsed.conflicts.map(() => null as Choice | null);
    const custom = parsed.conflicts.map(() => null as string[] | null);
    for (const [i, o] of sug.outcomes) {
      if (i < choices.length) {
        choices[i] = o.choice;
        custom[i] = o.custom ? [...o.custom] : null;
      }
    }
    const content = buildResult(parsed, choices, custom);
    if (hasMarkers(content)) {
      changed.push(path);
      continue;
    }
    files.push({ path, content });
  }
  if (files.length) await tab.saveResolutions(files);
  if (changed.length) {
    app.toast("info", `${changed.length} file${changed.length === 1 ? " was" : "s were"} left as is`, "They changed since the AI looked at them. Open them to review.");
  }
}

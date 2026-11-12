import { SvelteSet } from "svelte/reactivity";
import {
  asRemoteError,
  chatStore,
  git,
  pickDirectory,
  pickFolder,
  type Branch,
  type ChatMessage,
  type Commit,
  type ConflictSide,
  type FileChange,
  type RemoteError,
  type RepoInfo,
  type RepoOperation,
  type TreeEntry,
} from "./api";
import { layoutGraph, type GraphLayout } from "./graph";
import { computeSync } from "./sync";
import type { AiOutcome } from "./conflictAi";

export type View = "history" | "changes" | "files";

/** One turn of the assistant conversation. `display` is what the user sees. */
export interface ChatTurn extends ChatMessage {
  display?: string;
  error?: boolean;
}

/** A saved AI conversation, like a chat in any AI app. */
export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ChatTurn[];
}

const MAX_CONVERSATIONS = 50;
export type RemoteOp = "fetch" | "pull" | "push";

/** A fetch, pull or push that didn't go through, kept until it's fixed or dismissed. */
export interface RemoteIssue {
  op: RemoteOp;
  error: RemoteError;
  at: number;
}

/** Problems the user has to act on (sign in, pull first…), so they get the help dialog. */
const NEEDS_HELP = new Set(["sso", "auth", "behind", "rejected", "not-pushed"]);

export interface RecentRepo {
  path: string;
  name: string;
  openedAt: number;
}

/** Colours a tab group can take, tuned to sit well on the dark theme. */
export const GROUP_COLORS = {
  // Ordered so consecutive new groups get clearly different hues.
  violet: "oklch(0.72 0.19 300)",
  green: "oklch(0.76 0.16 150)",
  orange: "oklch(0.76 0.16 55)",
  blue: "oklch(0.72 0.15 250)",
  rose: "oklch(0.72 0.19 10)",
  yellow: "oklch(0.84 0.15 90)",
  cyan: "oklch(0.8 0.12 195)",
  grey: "oklch(0.7 0.02 300)",
} as const;
export type GroupColor = keyof typeof GROUP_COLORS;

/**
 * A named set of related repositories. Groups outlive their tabs: closing a
 * group keeps it (and its paths) so it can be reopened in one click.
 */
export interface TabGroup {
  id: string;
  name: string;
  color: GroupColor;
  /** Repositories in the group, in tab order. */
  paths: string[];
}

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  message?: string;
}

type ToastFn = (kind: Toast["kind"], title: string, message?: string) => void;

const RECENTS_KEY = "orbe.recentRepos";
const TABS_KEY = "orbe.tabs";
const DRAFTS_KEY = "orbe.commitDrafts";
const GROUPS_KEY = "orbe.tabGroups";

function lastIndex<T>(list: T[], test: (item: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return i;
  return -1;
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") ?? fallback;
  } catch {
    return fallback;
  }
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

// ---------------------------------------------------------------------------
// One open repository (or an empty "new tab")
// ---------------------------------------------------------------------------

let tabSeq = 0;

export class RepoTab {
  readonly id = ++tabSeq;

  repo = $state<RepoInfo | null>(null);
  view = $state<View>("history");
  /** Tab group this tab belongs to, if any. */
  groupId = $state<string | null>(null);

  commits = $state.raw<Commit[]>([]);
  graph = $state.raw<GraphLayout>({ rows: [], maxLanes: 1 });
  branches = $state<Branch[]>([]);
  status = $state<FileChange[]>([]);

  selectedHash = $state<string | null>(null);
  selectedChange = $state<FileChange | null>(null);

  loading = $state(false);
  remoteOp = $state<RemoteOp | null>(null);

  /** Unsent commit message, kept per tab. */
  /** First line is the summary, the rest the description (like VS Code). */
  #draft = $state("");
  get draftMessage() {
    return this.#draft;
  }
  /** Saved per repository, so a reload or restart never loses a half-written message. */
  set draftMessage(text: string) {
    this.#draft = text;
    const path = this.repo?.path;
    if (!path) return;
    const drafts = loadJSON<Record<string, string>>(DRAFTS_KEY, {});
    if (text.trim()) drafts[path] = text;
    else delete drafts[path];
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  }

  /** Whole-project file tree (loaded the first time the Files view opens). */
  tree = $state.raw<TreeEntry[]>([]);
  treeLoaded = $state(false);
  treeLoading = $state(false);
  selectedFile = $state<string | null>(null);
  expanded = new SvelteSet<string>();

  /** When the remotes were last fetched (ms), for "to pull" freshness. */
  lastFetched = $state<number | null>(null);

  /** The last fetch/pull/push that failed, until it succeeds or is dismissed. */
  remoteIssue = $state<RemoteIssue | null>(null);
  /** Whether the help dialog for `remoteIssue` is open. */
  remoteIssueOpen = $state(false);
  /** A remote operation has been running long enough that it may be waiting on a browser sign-in. */
  remoteSlow = $state(false);

  /** A merge/rebase stopped half-way (usually for conflicts), or null. */
  operation = $state<RepoOperation | null>(null);
  /**
   * "Resolve all with AI" results waiting to be shown, by file path. Each
   * file's conflict view applies them when it opens (if the file hasn't
   * changed since), so they're reviewed before anything is saved.
   */
  aiConflictSuggestions = $state<Record<string, { text: string; outcomes: [number, AiOutcome][]; rev: number }>>({});
  /** Progress of a running "Resolve all with AI". */
  aiResolving = $state<{ done: number; total: number } | null>(null);

  /** Branch being switched to, for instant feedback while git works. */
  pendingCheckout = $state<string | null>(null);

  /** AI conversations for this repository, saved to disk and restored on open. */
  chats = $state<Conversation[]>([]);
  activeChatId = $state<string | null>(null);
  /** Conversations waiting for a reply. */
  busyChats = new SvelteSet<string>();
  activeChat = $derived(this.chats.find((c) => c.id === this.activeChatId) ?? null);

  /** Turns of the open conversation. */
  get chat(): ChatTurn[] {
    return this.activeChat?.turns ?? [];
  }

  get chatBusy(): boolean {
    return !!this.activeChatId && this.busyChats.has(this.activeChatId);
  }

  /** Recent conversations first. */
  get sortedChats(): Conversation[] {
    return [...this.chats].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async loadChats() {
    const repo = this.repo?.path;
    if (!repo) return;
    try {
      const raw = await chatStore.load(repo);
      if (!raw || this.repo?.path !== repo) return;
      const data = JSON.parse(raw) as { active?: string | null; chats?: Conversation[] };
      this.chats = Array.isArray(data.chats) ? data.chats : [];
      this.activeChatId = this.chats.some((c) => c.id === data.active) ? (data.active ?? null) : null;
    } catch {
      // A corrupt file shouldn't block the repository; start fresh.
      this.chats = [];
    }
  }

  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  saveChats() {
    const repo = this.repo?.path;
    if (!repo) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      // Keep the most recent conversations.
      const chats = this.sortedChats.slice(0, MAX_CONVERSATIONS);
      const data = JSON.stringify({ version: 1, repo, active: this.activeChatId, chats: $state.snapshot(chats) });
      chatStore.save(repo, data).catch((e) => this.toast("error", "Couldn't save the conversation", errorText(e)));
    }, 300);
  }

  /** Start a fresh conversation (the current one stays in the history). */
  newChat() {
    this.activeChatId = null;
    this.saveChats();
  }

  openChat(id: string) {
    this.activeChatId = id;
    this.saveChats();
  }

  /** Close a conversation for good. */
  closeChat(id: string) {
    this.chats = this.chats.filter((c) => c.id !== id);
    if (this.activeChatId === id) this.activeChatId = null;
    this.saveChats();
  }

  /** The open conversation, creating one titled after the first message if needed. */
  ensureChat(firstMessage: string): Conversation {
    if (this.activeChat) return this.activeChat;
    const now = Date.now();
    const title = firstMessage.replace(/\s+/g, " ").trim();
    const chat: Conversation = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      title: title.length > 60 ? `${title.slice(0, 57)}…` : title || "New chat",
      createdAt: now,
      updatedAt: now,
      turns: [],
    };
    this.chats.push(chat);
    this.activeChatId = chat.id;
    // Return the reactive proxy so later pushes update the UI.
    return this.chats[this.chats.length - 1];
  }

  headBranch = $derived(this.branches.find((b) => b.isHead) ?? null);
  /** Looking at a commit directly instead of a branch ("detached HEAD"). */
  detached = $derived(this.commits.length > 0 && this.branches.length > 0 && !this.branches.some((b) => b.isHead));
  /** The commit HEAD points at. */
  headCommit = $derived(this.commits.find((c) => c.refs.some((r) => r === "HEAD" || r.startsWith("HEAD -> "))) ?? null);
  /** Branch you were on before checking out a commit, to go back to. */
  previousBranch = $state<string | null>(null);
  /** Per-commit pushed / to-push / to-pull state for the history list. */
  sync = $derived(computeSync(this.commits, this.branches));
  staged = $derived(this.status.filter((s) => s.staged));
  unstaged = $derived(this.status.filter((s) => !s.staged));
  selectedCommit = $derived(this.commits.find((c) => c.hash === this.selectedHash) ?? null);
  title = $derived(this.repo?.name ?? "New tab");

  constructor(private toast: ToastFn) {}

  async open(path: string): Promise<boolean> {
    this.loading = true;
    try {
      const info = await git.openRepo(path);
      this.repo = info;
      this.selectedHash = null;
      this.selectedChange = null;
      await this.refresh();
      this.selectedHash = this.commits[0]?.hash ?? null;
      void this.loadChats();
      this.#draft = loadJSON<Record<string, string>>(DRAFTS_KEY, {})[info.path] ?? "";
      return true;
    } catch (e) {
      this.toast("error", "Couldn't open repository", errorText(e));
      return false;
    } finally {
      this.loading = false;
    }
  }

  async refresh() {
    const repo = this.repo;
    if (!repo) return;
    try {
      const [commits, branches, status, operation] = await Promise.all([
        git.log(repo.path),
        git.branches(repo.path),
        git.status(repo.path),
        git.operation(repo.path).catch(() => null),
      ]);
      // The tab may have been pointed elsewhere while we were waiting.
      if (this.repo?.path !== repo.path) return;
      this.commits = commits;
      this.graph = layoutGraph(commits);
      this.branches = branches;
      this.status = status;
      this.operation = operation;
      const head = branches.find((b) => b.isHead);
      const headName = head?.name ?? (branches.length ? null : this.repo.head);
      if (this.repo.head !== headName) this.repo = { ...this.repo, head: headName };
      if (this.treeLoaded) void this.loadTree();
      // AI suggestions only matter for files that are still conflicted.
      const stillConflicted = new Set(status.filter((s) => s.status === "conflicted").map((s) => s.path));
      if (Object.keys(this.aiConflictSuggestions).some((p) => !stillConflicted.has(p))) {
        this.aiConflictSuggestions = Object.fromEntries(Object.entries(this.aiConflictSuggestions).filter(([p]) => stillConflicted.has(p)));
      }
      if (this.selectedChange) {
        const sel = this.selectedChange;
        this.selectedChange =
          status.find((s) => s.path === sel.path && s.staged === sel.staged) ??
          status.find((s) => s.path === sel.path) ??
          null;
      }
    } catch (e) {
      this.toast("error", "Refresh failed", errorText(e));
    }
  }

  async loadTree() {
    const repo = this.repo;
    if (!repo) return;
    this.treeLoading = true;
    try {
      const tree = await git.tree(repo.path);
      if (this.repo?.path !== repo.path) return;
      this.tree = tree;
      this.treeLoaded = true;
    } catch (e) {
      this.toast("error", "Couldn't read the project files", errorText(e));
    } finally {
      this.treeLoading = false;
    }
  }

  /** Run a git operation, report the outcome and refresh. Resolves to success. */
  private async mutate(work: (path: string) => Promise<unknown>, failTitle: string, success?: string): Promise<boolean> {
    if (!this.repo) return false;
    let ok = true;
    try {
      await work(this.repo.path);
      if (success) this.toast("success", success);
    } catch (e) {
      ok = false;
      this.toast("error", failTitle, errorText(e));
    }
    await this.refresh();
    return ok;
  }

  stage(files: FileChange[]) {
    if (!files.length) return;
    return this.mutate((p) => git.stage(p, files.map((f) => f.path)), "Couldn't stage files");
  }

  unstage(files: FileChange[]) {
    if (!files.length) return;
    return this.mutate((p) => git.unstage(p, files.map((f) => f.path)), "Couldn't unstage files");
  }

  discard(files: FileChange[]) {
    if (!files.length) return;
    const tracked = files.filter((f) => f.status !== "untracked").map((f) => f.path);
    const untracked = files.filter((f) => f.status === "untracked").map((f) => f.path);
    return this.mutate((p) => git.discard(p, tracked, untracked), "Couldn't discard changes");
  }

  async commit(message: string, amend = false): Promise<boolean> {
    if (!this.repo) return false;
    try {
      const short = await git.commit(this.repo.path, message, amend);
      this.toast("success", amend ? "Commit amended" : "Committed", `${short} · ${message.split("\n")[0]}`);
      this.selectedChange = null;
      this.draftMessage = "";
      await this.refresh();
      this.selectedHash = this.commits[0]?.hash ?? null;
      return true;
    } catch (e) {
      this.toast("error", "Commit failed", errorText(e));
      return false;
    }
  }

  async checkout(branch: Branch) {
    if (!this.repo || branch.isHead || branch.kind === "tag") return;
    const repo = this.repo;
    let name = branch.name;
    let remote = branch.kind === "remote";
    if (remote) {
      // If a local branch already tracks this remote, switch to it instead.
      const local = this.branches.find((b) => b.kind === "local" && b.upstream === branch.name);
      if (local) {
        name = local.name;
        remote = false;
      }
    }
    // Optimistic update: show the new branch immediately, roll back on failure.
    const target = remote ? name.split("/").slice(1).join("/") : name;
    const before = { branches: this.branches, repo };
    this.pendingCheckout = branch.name;
    this.branches = this.branches.map((b) => ({ ...b, isHead: b.kind === "local" && b.name === target }));
    this.repo = { ...repo, head: target };
    try {
      await git.checkout(repo.path, name, remote);
      this.toast("success", "Switched branch", target);
    } catch (e) {
      if (this.repo?.path === repo.path) {
        this.branches = before.branches;
        this.repo = before.repo;
      }
      this.toast("error", "Couldn't switch branch", errorText(e));
    } finally {
      this.pendingCheckout = null;
    }
    await this.refresh();
  }

  /** Check out a commit directly to see the project as it was (detached HEAD). */
  async checkoutCommit(commit: Commit) {
    if (!this.repo) return;
    if (this.headBranch) this.previousBranch = this.headBranch.name;
    try {
      await git.checkoutCommit(this.repo.path, commit.hash);
      this.toast("success", `Viewing ${commit.shortHash}`, "You're on an older commit. Use “Back” to return to your branch.");
    } catch (e) {
      this.toast("error", "Couldn't check out this commit", errorText(e));
    }
    await this.refresh();
    this.selectedHash = commit.hash;
  }

  /** Leave a detached commit and return to the branch you came from. */
  async backToBranch() {
    const locals = this.branches.filter((b) => b.kind === "local");
    const name = this.previousBranch;
    const target =
      locals.find((b) => b.name === name) ??
      locals.find((b) => b.name === "main") ??
      locals.find((b) => b.name === "master") ??
      locals[0];
    if (!target) return;
    await this.checkout(target);
    this.selectedHash = this.headCommit?.hash ?? this.selectedHash;
  }

  // ---- creating and managing refs ---------------------------------------------

  async createBranch(name: string, start: string | null, checkout: boolean) {
    const ok = await this.mutate(
      (p) => git.createBranch(p, name, start, checkout),
      "Couldn't create branch",
      checkout ? `Switched to new branch ${name}` : `Created branch ${name}`,
    );
    if (ok && checkout && this.repo) this.repo = { ...this.repo, head: name };
    return ok;
  }

  renameBranch(old: string, name: string) {
    return this.mutate((p) => git.renameBranch(p, old, name), "Couldn't rename branch", `Renamed to ${name}`);
  }

  deleteBranch(name: string, force: boolean) {
    return this.mutate((p) => git.deleteBranch(p, name, force), "Couldn't delete branch", `Deleted branch ${name}`);
  }

  deleteRemoteBranch(name: string) {
    return this.mutate((p) => git.deleteRemoteBranch(p, name), "Couldn't delete remote branch", `Deleted ${name}`);
  }

  merge(name: string) {
    const into = this.headBranch?.name ?? "the current branch";
    return this.mutate((p) => git.merge(p, name), "Merge stopped", `Merged ${name} into ${into}`);
  }

  /** Merge `source` into `target` (switching to `target` first if needed). */
  async mergeInto(source: string, target: string) {
    if (!this.repo) return;
    try {
      const result = await git.mergeInto(this.repo.path, source, target);
      if (result === "conflicts") {
        this.toast("info", "Merge needs your help", "Some files conflict. Resolve them in Changes, then press Continue.");
        this.view = "changes";
      } else {
        this.toast("success", `Merged ${source} into ${target}`);
      }
    } catch (e) {
      this.toast("error", "Couldn't merge", errorText(e));
    }
    await this.refresh();
  }

  /** Replay `branch` on top of `onto`. */
  async rebaseOnto(branch: string, onto: string) {
    if (!this.repo) return;
    try {
      const result = await git.rebaseOnto(this.repo.path, branch, onto);
      if (result === "conflicts") {
        this.toast("info", "Rebase paused", "Resolve the conflicts in Changes, then press Continue.");
        this.view = "changes";
      } else {
        this.toast("success", `Rebased ${branch} onto ${onto}`);
      }
    } catch (e) {
      this.toast("error", "Couldn't rebase", errorText(e));
    }
    await this.refresh();
  }

  /** Keep one whole side of a conflicted file (or its deletion) and stage it. */
  async resolveConflict(file: string, side: ConflictSide) {
    const ok = await this.mutate((p) => git.resolveConflict(p, file, side), "Couldn't resolve the conflict", `Resolved ${baseName(file)}`);
    if (ok) this.afterResolve(file);
    return ok;
  }

  /** Save a resolved file and mark it resolved by staging it. */
  async saveResolution(file: string, content: string) {
    const ok = await this.mutate(
      async (p) => {
        await git.writeFile(p, file, content);
        await git.stage(p, [file]);
      },
      "Couldn't save the resolution",
      `Resolved ${baseName(file)}`,
    );
    if (ok) this.afterResolve(file);
    return ok;
  }

  /** Save several resolved files at once and stage them ("Apply AI to all"). */
  async saveResolutions(files: { path: string; content: string }[]) {
    if (!files.length) return false;
    const ok = await this.mutate(
      async (p) => {
        for (const f of files) await git.writeFile(p, f.path, f.content);
        await git.stage(p, files.map((f) => f.path));
      },
      "Couldn't save the resolutions",
      `Resolved ${files.length} file${files.length === 1 ? "" : "s"}`,
    );
    if (ok) this.afterResolve(files[files.length - 1].path);
    return ok;
  }

  /** Move on to the next conflicted file, or say what's left to do. */
  private afterResolve(done: string) {
    const next = this.status.find((s) => s.status === "conflicted" && s.path !== done);
    if (next) this.selectedChange = next;
    else if (this.operation) this.toast("info", "All conflicts resolved", `Press Continue to finish the ${this.operation}.`);
  }

  continueOperation() {
    const op = this.operation ?? "operation";
    return this.mutate((p) => git.continueOperation(p), `Couldn't continue the ${op}`, `${op[0].toUpperCase()}${op.slice(1)} completed`);
  }

  abortOperation() {
    const op = this.operation ?? "operation";
    return this.mutate((p) => git.abortOperation(p), `Couldn't abort the ${op}`, `${op[0].toUpperCase()}${op.slice(1)} aborted`);
  }

  createTag(name: string, target: string | null, message: string | null) {
    return this.mutate((p) => git.createTag(p, name, target, message), "Couldn't create tag", `Created tag ${name}`);
  }

  deleteTag(name: string) {
    return this.mutate((p) => git.deleteTag(p, name), "Couldn't delete tag", `Deleted tag ${name}`);
  }

  stash(message: string, includeUntracked: boolean) {
    return this.mutate((p) => git.stash(p, message, includeUntracked), "Couldn't stash changes", "Changes stashed");
  }

  stashPop() {
    return this.mutate((p) => git.stashPop(p), "Couldn't apply the stash", "Stash applied");
  }

  // ---- project files ------------------------------------------------------------

  /** Show a file in the Files view, opening its folders. */
  async openFile(path: string) {
    if (!this.treeLoaded) await this.loadTree();
    this.revealInTree(path);
    this.selectedFile = path;
    this.view = "files";
  }

  revealInTree(path: string) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) this.expanded.add(parts.slice(0, i).join("/"));
  }

  async createFile(file: string) {
    const ok = await this.mutate((p) => git.createFile(p, file), "Couldn't create file", `Created ${file}`);
    if (ok) {
      await this.loadTree();
      this.revealInTree(file);
      this.selectedFile = file;
      this.view = "files";
    }
    return ok;
  }

  async createFolder(folder: string) {
    const ok = await this.mutate((p) => git.createFolder(p, folder), "Couldn't create folder", `Created ${folder}/`);
    if (ok) {
      await this.loadTree();
      this.revealInTree(folder + "/x");
      this.view = "files";
    }
    return ok;
  }

  async renamePath(from: string, to: string) {
    const ok = await this.mutate((p) => git.renamePath(p, from, to), "Couldn't rename", `Renamed to ${to}`);
    if (ok) {
      await this.loadTree();
      this.revealInTree(to);
      if (this.selectedFile === from) this.selectedFile = to;
    }
    return ok;
  }

  async deletePath(target: string) {
    const ok = await this.mutate((p) => git.deletePath(p, target), "Couldn't delete", `Moved ${target} to the trash`);
    if (ok) {
      await this.loadTree();
      if (this.selectedFile === target || this.selectedFile?.startsWith(target + "/")) this.selectedFile = null;
    }
    return ok;
  }

  /**
   * Quietly fetch so ahead/behind counts reflect the remote. Never changes your
   * files. Tells you only when new commits arrive for the current branch.
   */
  async backgroundFetch() {
    if (!this.repo || this.remoteOp || this.operation) return;
    const repo = this.repo;
    const before = this.headBranch?.behind ?? 0;
    try {
      await git.fetch(repo.path);
      this.lastFetched = Date.now();
      if (this.remoteIssue?.op === "fetch") this.remoteIssue = null;
    } catch (e) {
      // Offline: try again next time, no noise. Sign-in problems get a quiet
      // indicator, so you find out before you try to push.
      const error = asRemoteError(e);
      if ((error.kind === "sso" || error.kind === "auth") && !this.remoteIssue) {
        this.remoteIssue = { op: "fetch", error, at: Date.now() };
      }
      return;
    }
    if (this.repo?.path !== repo.path) return;
    await this.refresh();
    const head = this.headBranch;
    if (head && head.behind > before) {
      const n = head.behind - before;
      this.toast("info", `${n} new commit${n === 1 ? "" : "s"} to pull`, `${head.upstream ?? "The remote"} has changes for ${head.name}.`);
    }
  }

  async remote(op: RemoteOp) {
    if (!this.repo || this.remoteOp) return;
    this.remoteOp = op;
    this.remoteSlow = false;
    // Credential helpers may be waiting for a sign-in in the browser: say so.
    const slow = setTimeout(() => (this.remoteSlow = true), 8000);
    const labels = { fetch: "Fetched", pull: "Pulled", push: "Pushed" } as const;
    let ok = false;
    try {
      await git[op](this.repo.path);
      ok = true;
      this.lastFetched = Date.now();
      // Signing in works again, or this very operation now went through.
      const issue = this.remoteIssue;
      if (issue && (issue.op === op || issue.error.kind === "sso" || issue.error.kind === "auth")) {
        this.remoteIssue = null;
        this.remoteIssueOpen = false;
      }
      this.toast("success", labels[op], op === "fetch" ? `${this.repo.name} is up to date` : this.headBranch?.name);
    } catch (e) {
      const error = asRemoteError(e);
      const help = NEEDS_HELP.has(error.kind);
      // A push that didn't happen always stays visible; so does anything needing your action.
      if (help || op === "push") this.remoteIssue = { op, error, at: Date.now() };
      if (help) this.remoteIssueOpen = true;
      else this.toast("error", `${op[0].toUpperCase()}${op.slice(1)} failed`, error.message);
    } finally {
      clearTimeout(slow);
      this.remoteSlow = false;
      this.remoteOp = null;
    }
    await this.refresh();
    return ok;
  }

  /** The remote has newer commits: bring them in, then push again. */
  async pullThenPush() {
    if (await this.remote("pull")) await this.remote("push");
  }

  dismissRemoteIssue() {
    this.remoteIssue = null;
    this.remoteIssueOpen = false;
  }
}

// ---------------------------------------------------------------------------
// Application: tabs, recents, overlays, toasts.
// Repo-level fields proxy to the active tab so components can stay simple.
// ---------------------------------------------------------------------------

class AppState {
  tabs = $state<RepoTab[]>([]);
  activeId = $state(0);
  recents = $state<RecentRepo[]>(loadJSON(RECENTS_KEY, []));
  groups = $state<TabGroup[]>(loadJSON(GROUPS_KEY, []));
  paletteOpen = $state(false);
  settingsOpen = $state(false);
  /** URL being cloned, while a clone runs. */
  cloning = $state<string | null>(null);
  toasts = $state<Toast[]>([]);

  active = $derived(this.tabs.find((t) => t.id === this.activeId) ?? this.tabs[0]);

  constructor() {
    this.tabs = [this.makeTab()];
    this.activeId = this.tabs[0].id;
  }

  private makeTab() {
    return new RepoTab((k, t, m) => this.toast(k, t, m));
  }

  // ---- proxies to the active tab -------------------------------------------

  get repo() { return this.active?.repo ?? null; }
  get view() { return this.active?.view ?? "history"; }
  set view(v: View) { if (this.active) this.active.view = v; }
  get commits() { return this.active?.commits ?? []; }
  get graph() { return this.active?.graph ?? { rows: [], maxLanes: 1 }; }
  get branches() { return this.active?.branches ?? []; }
  get status() { return this.active?.status ?? []; }
  get selectedHash() { return this.active?.selectedHash ?? null; }
  set selectedHash(h: string | null) { if (this.active) this.active.selectedHash = h; }
  get selectedChange() { return this.active?.selectedChange ?? null; }
  set selectedChange(c: FileChange | null) { if (this.active) this.active.selectedChange = c; }
  get loading() { return this.active?.loading ?? false; }
  get remoteOp() { return this.active?.remoteOp ?? null; }
  get headBranch() { return this.active?.headBranch ?? null; }
  get staged() { return this.active?.staged ?? []; }
  get unstaged() { return this.active?.unstaged ?? []; }
  get selectedCommit() { return this.active?.selectedCommit ?? null; }

  refresh() { return this.active?.refresh(); }
  stage(f: FileChange[]) { return this.active?.stage(f); }
  unstage(f: FileChange[]) { return this.active?.unstage(f); }
  discard(f: FileChange[]) { return this.active?.discard(f); }
  commit(message: string, amend = false) { return this.active?.commit(message, amend) ?? Promise.resolve(false); }
  checkout(b: Branch) { return this.active?.checkout(b); }
  remote(op: RemoteOp) { return this.active?.remote(op); }

  // ---- tabs -----------------------------------------------------------------

  newTab() {
    const tab = this.makeTab();
    this.tabs.push(tab);
    this.activeId = tab.id;
    this.saveTabs();
    return tab;
  }

  activate(id: number) {
    if (this.activeId === id) return;
    this.activeId = id;
    this.rememberBlockFocus();
    this.saveTabs();
    // Pick up anything that changed while the tab was in the background.
    this.active?.refresh();
  }

  closeTab(id: number) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    this.tabs.splice(idx, 1);
    if (this.tabs.length === 0) this.tabs.push(this.makeTab());
    if (this.activeId === id) this.activeId = this.tabs[Math.min(idx, this.tabs.length - 1)].id;
    this.saveTabs();
  }

  cycleTab(dir: 1 | -1) {
    const idx = this.tabs.findIndex((t) => t.id === this.activeId);
    const next = this.tabs[(idx + dir + this.tabs.length) % this.tabs.length];
    if (next) this.activate(next.id);
  }

  /**
   * Ctrl+←/→: step through the strip as you see it. Only the active group is
   * unfolded; every other group is one stop, landing on its last-used tab.
   */
  stepTab(dir: 1 | -1) {
    const open = this.openGroupId;
    const seen = new Set<string>();
    const stops: RepoTab[] = [];
    for (const t of this.tabs) {
      if (!t.groupId || t.groupId === open) stops.push(t);
      else if (!seen.has(t.groupId)) {
        seen.add(t.groupId);
        stops.push(this.groupFocusTab(t.groupId) ?? t);
      }
    }
    const idx = stops.findIndex((t) => t.id === this.activeId);
    const next = stops[(idx + dir + stops.length) % stops.length];
    if (next && next.id !== this.activeId) this.activate(next.id);
  }

  /** The tab you last used in a group (its first tab if none yet). */
  groupFocusTab(groupId: string) {
    const tabs = this.tabsIn(groupId);
    const remembered = this.blockFocus.get(groupId);
    return tabs.find((t) => t.id === remembered) ?? tabs[0];
  }

  /** Unfold a group by focusing the tab you last used in it. */
  focusGroup(groupId: string) {
    const tab = this.groupFocusTab(groupId);
    if (tab) this.activate(tab.id);
  }

  /**
   * The focused tab's group can be folded by hand. Remembered with the tab it
   * was folded on, so focusing any other tab unfolds things again by itself.
   */
  private foldedOn = $state<number | null>(null);

  /** The group shown unfolded in the strip, if any. */
  get openGroupId() {
    const g = this.active?.groupId ?? null;
    return g && this.foldedOn !== this.activeId ? g : null;
  }

  /** Click on a group: fold or unfold it if you're in it, otherwise jump into it. */
  toggleGroupFold(groupId: string) {
    if (this.active?.groupId === groupId) {
      this.foldedOn = this.openGroupId ? this.activeId : null;
    } else {
      this.focusGroup(groupId);
    }
  }

  /** Last tab focused in each group (or in each run of ungrouped tabs), keyed by its first tab. */
  private blockFocus = new Map<string, number>();

  /** The strip as blocks: each group, and each run of ungrouped tabs between them. */
  private blocks() {
    const out: { key: string; tabs: RepoTab[] }[] = [];
    for (const t of this.tabs) {
      const last = out[out.length - 1];
      const key = t.groupId ?? `loose-${t.id}`;
      if (last && (t.groupId ? last.key === t.groupId : last.key.startsWith("loose-"))) last.tabs.push(t);
      else out.push({ key, tabs: [t] });
    }
    return out;
  }

  /**
   * Ctrl+↑/↓: jump to the previous/next group (a run of ungrouped tabs counts
   * as one), landing on the tab you last used there. Collapsed groups open up.
   */
  private rememberBlockFocus() {
    const block = this.blocks().find((b) => b.tabs.some((t) => t.id === this.activeId));
    if (block) this.blockFocus.set(block.key, this.activeId);
  }

  stepGroup(dir: 1 | -1) {
    const blocks = this.blocks();
    if (blocks.length < 2) return;
    const idx = blocks.findIndex((b) => b.tabs.some((t) => t.id === this.activeId));
    this.rememberBlockFocus();
    const next = blocks[(idx + dir + blocks.length) % blocks.length];
    const remembered = this.blockFocus.get(next.key);
    const target = next.tabs.find((t) => t.id === remembered) ?? next.tabs[0];
    this.activate(target.id);
  }

  reorderTabs(tabs: RepoTab[]) {
    this.tabs = tabs;
    this.saveTabs();
  }

  /** Open a repo: focus it if already open, reuse an empty tab, or add a new one. */
  async open(path: string) {
    const existing = this.tabs.find((t) => t.repo?.path === path);
    if (existing) {
      this.activate(existing.id);
      return;
    }
    const target = this.active && !this.active.repo ? this.active : this.newTab();
    this.activeId = target.id;
    const ok = await target.open(path);
    if (ok && target.repo) {
      // `open` may resolve to the repo root; de-duplicate on that too.
      const dup = this.tabs.find((t) => t !== target && t.repo?.path === target.repo!.path);
      if (dup) {
        this.closeTab(target.id);
        this.activate(dup.id);
        return;
      }
      this.rememberRecent(target.repo);
    } else if (!ok && this.tabs.length > 1 && !target.repo) {
      this.closeTab(target.id);
    }
    this.saveTabs();
  }

  async openFolder() {
    const path = await pickFolder();
    if (path) await this.open(path);
  }

  /** `git init` a folder (created if needed) and open it. */
  async initRepo(path: string) {
    try {
      await git.initRepo(path);
      await this.open(path);
      this.toast("success", "Repository created", path);
    } catch (e) {
      this.toast("error", "Couldn't create repository", errorText(e));
    }
  }

  /** Clone into `dest` and open it in a tab. Shows progress on a fresh tab. */
  async cloneRepo(url: string, dest: string) {
    this.cloning = url;
    try {
      const path = await git.cloneRepo(url, dest);
      await this.open(path);
      this.toast("success", "Cloned", url);
    } catch (e) {
      this.toast("error", "Clone failed", errorText(e));
    } finally {
      this.cloning = null;
    }
  }

  pickDirectory = pickDirectory;

  /** Return the active tab to the welcome screen. */
  close() {
    if (this.active?.repo) {
      const id = this.active.id;
      const idx = this.tabs.findIndex((t) => t.id === id);
      const fresh = this.makeTab();
      fresh.groupId = this.active.groupId;
      this.tabs[idx] = fresh;
      this.activeId = fresh.id;
      this.saveTabs();
    }
  }

  private saveTabs() {
    const paths = this.tabs.map((t) => t.repo?.path ?? null);
    const groups = this.tabs.map((t) => t.groupId);
    const active = this.tabs.findIndex((t) => t.id === this.activeId);
    localStorage.setItem(TABS_KEY, JSON.stringify({ paths, groups, active }));
    this.syncGroups();
  }

  /** Reopen the tabs from the last session. */
  async restoreTabs() {
    const saved = loadJSON<{ paths: (string | null)[]; groups?: (string | null)[]; active: number } | null>(TABS_KEY, null);
    if (!saved?.paths?.length) return;
    const known = new Set(this.groups.map((g) => g.id));
    const tabs = saved.paths.map((_, i) => {
      const tab = this.makeTab();
      const gid = saved.groups?.[i] ?? null;
      tab.groupId = gid && known.has(gid) ? gid : null;
      return tab;
    });
    this.tabs = tabs;
    const first = Math.max(0, Math.min(saved.active, tabs.length - 1));
    this.activeId = tabs[first].id;
    // The tab you're looking at first, on its own; then the background tabs a
    // few at a time. Opening every tab at once started dozens of git processes
    // that all competed with the one on screen.
    const open = (i: number) => (saved.paths[i] ? tabs[i].open(saved.paths[i]!) : Promise.resolve(true));
    await open(first);
    const queue = saved.paths.map((_, i) => i).filter((i) => i !== first);
    const worker = async () => {
      for (let i = queue.shift(); i !== undefined; i = queue.shift()) await open(i);
    };
    await Promise.all(Array.from({ length: 3 }, worker));
    // Drop tabs whose repository no longer exists.
    const alive = this.tabs.filter((t, i) => t.repo || !saved.paths[i]);
    if (alive.length !== this.tabs.length) {
      const activeStillThere = alive.some((t) => t.id === this.activeId);
      this.tabs = alive.length ? alive : [this.makeTab()];
      if (!activeStillThere) this.activeId = this.tabs[0].id;
    }
    this.rememberBlockFocus();
    this.saveTabs();
  }

  // ---- tab groups -----------------------------------------------------------

  groupOf(tab: RepoTab | undefined | null) {
    return tab?.groupId ? (this.groups.find((g) => g.id === tab.groupId) ?? null) : null;
  }

  tabsIn(groupId: string) {
    return this.tabs.filter((t) => t.groupId === groupId);
  }

  private findGroup(id: string) {
    return this.groups.find((g) => g.id === id);
  }

  private saveGroups() {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(this.groups));
  }

  /**
   * Keep each group's saved paths in step with its tabs. Membership is
   * explicit: closing a tab never drops a repository from its group; only
   * removing it does. Open members follow tab order, closed ones keep theirs.
   */
  private syncGroups() {
    for (const g of this.groups) {
      const open = this.tabsIn(g.id)
        .map((t) => t.repo?.path)
        .filter((p): p is string => !!p);
      if (!open.length) continue;
      g.paths = [...open, ...g.paths.filter((p) => !open.includes(p))];
    }
    this.saveGroups();
  }

  /**
   * Move a tab into (or out of) a group, keeping each group's tabs side by side.
   * `index` places it at a given position among the group's tabs (or, when
   * leaving, at a position in the whole strip).
   */
  private place(tab: RepoTab, groupId: string | null, opts: { keepMembership?: boolean; index?: number } = {}) {
    const from = this.tabs.indexOf(tab);
    if (from === -1) return;
    const oldGroup = tab.groupId;
    // Leaving a group is an explicit "remove", unless we're just borrowing the tab.
    if (oldGroup && oldGroup !== groupId && !opts.keepMembership) {
      const old = this.findGroup(oldGroup);
      if (old) old.paths = old.paths.filter((p) => p !== tab.repo?.path);
    }
    this.tabs.splice(from, 1);
    let to = from;
    if (groupId) {
      const first = this.tabs.findIndex((t) => t.groupId === groupId);
      const last = lastIndex(this.tabs, (t) => t.groupId === groupId);
      if (last !== -1) to = opts.index === undefined ? last + 1 : Math.min(first + opts.index, last + 1);
    } else if (opts.index !== undefined) {
      to = opts.index;
    } else if (oldGroup) {
      // Step out just past the group's remaining tabs.
      const last = lastIndex(this.tabs, (t) => t.groupId === oldGroup);
      if (last >= from) to = last + 1;
    }
    tab.groupId = groupId;
    this.tabs.splice(Math.max(0, Math.min(to, this.tabs.length)), 0, tab);
  }

  private nextColor(): GroupColor {
    const used = new Set(this.groups.map((g) => g.color));
    const colors = Object.keys(GROUP_COLORS) as GroupColor[];
    return colors.find((c) => !used.has(c)) ?? colors[this.groups.length % colors.length];
  }

  /** Create a group from a set of repositories and open them side by side. */
  async createGroup(name: string, paths: string[]) {
    const group: TabGroup = {
      id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      color: this.nextColor(),
      paths: [...new Set(paths)],
    };
    this.groups.push(group);
    this.saveGroups();
    await this.openGroup(group.id);
    return this.findGroup(group.id)!;
  }

  /** Change which repositories belong to a group (and its name). */
  async editGroup(id: string, name: string, paths: string[]) {
    const g = this.findGroup(id);
    if (!g) return;
    g.name = name.trim();
    const keep = new Set(paths);
    // Tabs of repositories no longer in the group step out of it.
    for (const t of this.tabsIn(id)) {
      if (t.repo && !keep.has(t.repo.path)) this.place(t, null);
    }
    g.paths = [...keep];
    this.saveGroups();
    // An open group picks up its new members straight away.
    if (this.tabsIn(id).length) await this.openGroup(id, { focus: false });
    else this.saveTabs();
  }

  /** Put a tab in a group: instant, no questions (used by drag and drop too). */
  addToGroup(tab: RepoTab, groupId: string, index?: number) {
    const g = this.findGroup(groupId);
    if (!g) return;
    this.place(tab, groupId, { index });
    this.saveTabs();
  }

  /** Take a tab out of its group; `index` is where it lands in the strip. */
  removeFromGroup(tab: RepoTab, index?: number) {
    if (!tab.groupId) return;
    this.place(tab, null, { index });
    this.saveTabs();
  }

  updateGroup(id: string, patch: Partial<Pick<TabGroup, "name" | "color">>) {
    const g = this.findGroup(id);
    if (!g) return;
    Object.assign(g, patch);
    this.saveGroups();
  }

  /** New empty tab at the end of a group, ready to open a repository into. */
  newTabInGroup(id: string) {
    const tab = this.newTab();
    this.addToGroup(tab, id);
    return tab;
  }

  /** Pick a folder and open it as part of a group. */
  async openFolderInGroup(id: string) {
    const path = await pickFolder();
    if (!path) return;
    const existing = this.tabs.find((t) => t.repo?.path === path);
    if (existing) {
      this.addToGroup(existing, id);
      this.activate(existing.id);
      return;
    }
    const tab = this.newTabInGroup(id);
    await this.open(path);
    // `open` may have focused an already-open copy instead; drop the spare tab.
    if (!tab.repo && this.tabs.includes(tab)) this.closeTab(tab.id);
    const opened = this.active;
    if (opened?.repo && opened.groupId !== id) this.addToGroup(opened, id);
  }

  /** Close every tab in the group; the group and its repositories stay saved. */
  closeGroup(id: string) {
    this.syncGroups();
    const g = this.findGroup(id);
    if (!g) return;
    const idx = this.tabs.findIndex((t) => t.groupId === id);
    const remaining = this.tabs.filter((t) => t.groupId !== id);
    this.tabs = remaining.length ? remaining : [this.makeTab()];
    if (!this.tabs.some((t) => t.id === this.activeId)) {
      this.activeId = this.tabs[Math.max(0, Math.min(idx, this.tabs.length) - 1)].id;
    }
    this.saveTabs();
    this.toast("info", `Closed ${g.name || "group"}`, "It's saved. Reopen it any time from a new tab.");
  }

  /** Forget a group for good. Its open tabs stay open, ungrouped. Ask first! */
  deleteGroup(id: string) {
    for (const t of this.tabsIn(id)) t.groupId = null;
    this.groups = this.groups.filter((g) => g.id !== id);
    this.saveTabs();
  }

  /** Open every repository of a group, reusing tabs that are already open. */
  async openGroup(id: string, { focus = true } = {}) {
    const g = this.findGroup(id);
    if (!g) return;
    const blank = focus && this.active && !this.active.repo && !this.active.groupId ? this.active : null;
    const opening: [RepoTab, string][] = [];
    for (const path of [...g.paths]) {
      const existing = this.tabs.find((t) => t.repo?.path === path);
      if (existing) {
        // Borrow it from another group without dropping it from that one.
        if (existing.groupId !== id) this.place(existing, id, { keepMembership: true });
        continue;
      }
      const tab = this.makeTab();
      this.tabs.push(tab);
      this.place(tab, id);
      opening.push([tab, path]);
    }
    // The empty tab we launched from has done its job.
    if (blank && this.tabs.length > 1) this.tabs = this.tabs.filter((t) => t !== blank);
    const first = this.tabsIn(id)[0];
    if (focus && first) this.activeId = first.id;
    this.saveGroups();

    const results = await Promise.all(opening.map(([tab, path]) => tab.open(path)));
    // Repositories that can't be opened (a drive unplugged, say) stay in the
    // group; only their tabs go.
    const dead = new Set(opening.filter((_, i) => !results[i]).map(([t]) => t));
    if (dead.size) {
      this.tabs = this.tabs.filter((t) => !dead.has(t));
      if (!this.tabs.length) this.tabs.push(this.makeTab());
      if (!this.tabs.some((t) => t.id === this.activeId)) this.activeId = (this.tabsIn(id)[0] ?? this.tabs[0]).id;
    }
    for (const [tab, path] of opening) {
      if (!tab.repo) continue;
      // `open` resolves to the repository root; store that.
      if (tab.repo.path !== path) g.paths = g.paths.map((p) => (p === path ? tab.repo!.path : p));
      this.rememberRecent(tab.repo);
    }
    this.saveTabs();
  }

  // ---- recents --------------------------------------------------------------

  private rememberRecent(info: RepoInfo) {
    const next = [
      { path: info.path, name: info.name, openedAt: Date.now() },
      ...this.recents.filter((r) => r.path !== info.path),
    ].slice(0, 8);
    this.recents = next;
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  }

  forgetRecent(path: string) {
    this.recents = this.recents.filter((r) => r.path !== path);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(this.recents));
  }

  // ---- toasts ---------------------------------------------------------------

  private toastId = 0;
  toast(kind: Toast["kind"], title: string, message?: string) {
    const id = ++this.toastId;
    this.toasts = [...this.toasts, { id, kind, title, message }];
    setTimeout(() => this.dismiss(id), kind === "error" ? 7000 : 3500);
  }

  dismiss(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}

export const app = new AppState();

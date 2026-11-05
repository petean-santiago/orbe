import { SvelteSet } from "svelte/reactivity";
import {
  chatStore,
  git,
  pickDirectory,
  pickFolder,
  type Branch,
  type ChatMessage,
  type Commit,
  type FileChange,
  type RepoInfo,
  type TreeEntry,
} from "./api";
import { layoutGraph, type GraphLayout } from "./graph";

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

export interface RecentRepo {
  path: string;
  name: string;
  openedAt: number;
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

function loadJSON<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") ?? fallback;
  } catch {
    return fallback;
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// One open repository (or an empty "new tab")
// ---------------------------------------------------------------------------

let tabSeq = 0;

export class RepoTab {
  readonly id = ++tabSeq;

  repo = $state<RepoInfo | null>(null);
  view = $state<View>("history");

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
      const [commits, branches, status] = await Promise.all([
        git.log(repo.path),
        git.branches(repo.path),
        git.status(repo.path),
      ]);
      // The tab may have been pointed elsewhere while we were waiting.
      if (this.repo?.path !== repo.path) return;
      this.commits = commits;
      this.graph = layoutGraph(commits);
      this.branches = branches;
      this.status = status;
      const head = branches.find((b) => b.isHead);
      if (head && this.repo.head !== head.name) this.repo = { ...this.repo, head: head.name };
      if (this.treeLoaded) void this.loadTree();
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

  private revealInTree(path: string) {
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

  async remote(op: RemoteOp) {
    if (!this.repo || this.remoteOp) return;
    this.remoteOp = op;
    const labels = { fetch: "Fetched", pull: "Pulled", push: "Pushed" } as const;
    try {
      await git[op](this.repo.path);
      this.toast("success", labels[op], op === "fetch" ? `${this.repo.name} is up to date` : this.headBranch?.name);
    } catch (e) {
      this.toast("error", `${op[0].toUpperCase()}${op.slice(1)} failed`, errorText(e));
    } finally {
      this.remoteOp = null;
    }
    await this.refresh();
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
      this.tabs[idx] = fresh;
      this.activeId = fresh.id;
      this.saveTabs();
    }
  }

  private saveTabs() {
    const paths = this.tabs.map((t) => t.repo?.path ?? null);
    const active = this.tabs.findIndex((t) => t.id === this.activeId);
    localStorage.setItem(TABS_KEY, JSON.stringify({ paths, active }));
  }

  /** Reopen the tabs from the last session. */
  async restoreTabs() {
    const saved = loadJSON<{ paths: (string | null)[]; active: number } | null>(TABS_KEY, null);
    if (!saved?.paths?.length) return;
    const tabs = saved.paths.map(() => this.makeTab());
    this.tabs = tabs;
    this.activeId = tabs[Math.max(0, Math.min(saved.active, tabs.length - 1))].id;
    await Promise.all(saved.paths.map((p, i) => (p ? tabs[i].open(p) : Promise.resolve(true))));
    // Drop tabs whose repository no longer exists.
    const alive = this.tabs.filter((t, i) => t.repo || !saved.paths[i]);
    if (alive.length !== this.tabs.length) {
      const activeStillThere = alive.some((t) => t.id === this.activeId);
      this.tabs = alive.length ? alive : [this.makeTab()];
      if (!activeStillThere) this.activeId = this.tabs[0].id;
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

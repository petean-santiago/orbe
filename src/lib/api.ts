/**
 * Typed bridge to the Rust backend.
 *
 * When the UI runs inside Tauri, calls go to the `git` commands in
 * `src-tauri/src/git.rs`. In a plain browser (`pnpm dev`) we fall back to an
 * in-memory demo repository so the interface can be designed without Rust.
 */
import { invoke } from "@tauri-apps/api/core";
import { mock } from "./mock";

export type FileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "untracked"
  | "conflicted";

export interface RepoInfo {
  path: string;
  name: string;
  head: string | null;
}

export interface FileChange {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  staged: boolean;
}

export interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  email: string;
  timestamp: number;
  subject: string;
  refs: string[];
}

export interface Branch {
  name: string;
  kind: "local" | "remote" | "tag";
  isHead: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** Unix seconds of the tip commit (or tag creation). */
  updated: number;
}

/** A git operation stopped half-way, usually for conflicts. */
export type RepoOperation = "merge" | "rebase" | "cherry-pick" | "revert";

/** What git kept for a conflicted file. A missing side deleted the file. */
export interface ConflictInfo {
  base: boolean;
  ours: boolean;
  theirs: boolean;
  /** Current side (HEAD), e.g. "main". */
  oursLabel: string;
  /** Incoming side, e.g. "a1b2c3d Add search". */
  theirsLabel: string;
}

export type ConflictSide = "ours" | "theirs";

export interface TreeEntry {
  path: string;
  dir: boolean;
}

export interface FileContent {
  text: string | null;
  binary: boolean;
  size: number;
  truncated: boolean;
}

export type AiProvider = "none" | "anthropic" | "openai" | "compatible" | "claude-code" | "codex";

export interface AiConfig {
  provider: AiProvider;
  model: string;
  baseUrl: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) return invoke<T>(cmd, args);
  return mock<T>(cmd, args);
}

export const git = {
  openRepo: (path: string) => call<RepoInfo>("open_repo", { path }),
  status: (path: string) => call<FileChange[]>("get_status", { path }),
  log: (path: string, limit = 2000) => call<Commit[]>("get_log", { path, limit }),
  branches: (path: string) => call<Branch[]>("get_branches", { path }),
  fileDiff: (path: string, file: string, staged: boolean, untracked: boolean, ignoreWhitespace = false) =>
    call<string>("get_file_diff", { path, file, staged, untracked, ignoreWhitespace }),
  commitFiles: (path: string, hash: string) => call<FileChange[]>("get_commit_files", { path, hash }),
  commitFileDiff: (path: string, hash: string, file: string, oldPath: string | null, ignoreWhitespace = false) =>
    call<string>("get_commit_file_diff", { path, hash, file, oldPath, ignoreWhitespace }),
  /** A file at a given version ("HEAD:a.png", ":a.png" staged, "<hash>:a.png"), base64. */
  blobBase64: (path: string, spec: string) => call<string>("read_blob_base64", { path, spec }),
  stage: (path: string, files: string[]) => call<void>("stage_files", { path, files }),
  unstage: (path: string, files: string[]) => call<void>("unstage_files", { path, files }),
  discard: (path: string, tracked: string[], untracked: string[]) =>
    call<void>("discard_files", { path, tracked, untracked }),
  commit: (path: string, message: string, amend = false) =>
    call<string>("commit", { path, message, amend }),
  checkout: (path: string, name: string, remote: boolean) =>
    call<void>("checkout_branch", { path, name, remote }),
  /** Check out a commit directly (detached HEAD). */
  checkoutCommit: (path: string, hash: string) => call<void>("checkout_commit", { path, hash }),
  fetch: (path: string) => call<void>("fetch", { path }),
  pull: (path: string) => call<void>("pull", { path }),
  push: (path: string) => call<void>("push", { path }),

  createBranch: (path: string, name: string, start: string | null, checkout: boolean) =>
    call<void>("create_branch", { path, name, start, checkout }),
  renameBranch: (path: string, old: string, name: string) => call<void>("rename_branch", { path, old, new: name }),
  deleteBranch: (path: string, name: string, force: boolean) => call<void>("delete_branch", { path, name, force }),
  deleteRemoteBranch: (path: string, name: string) => call<void>("delete_remote_branch", { path, name }),
  merge: (path: string, name: string) => call<void>("merge_branch", { path, name }),
  /** Resolves to "merged" or "conflicts". */
  mergeInto: (path: string, source: string, target: string) => call<"merged" | "conflicts">("merge_into", { path, source, target }),
  /** Resolves to "rebased" or "conflicts". */
  rebaseOnto: (path: string, branch: string, onto: string) => call<"rebased" | "conflicts">("rebase_onto", { path, branch, onto }),
  operation: (path: string) => call<RepoOperation | null>("repo_operation", { path }),
  continueOperation: (path: string) => call<void>("continue_operation", { path }),
  abortOperation: (path: string) => call<void>("abort_operation", { path }),
  conflictInfo: (path: string, file: string) => call<ConflictInfo>("get_conflict_info", { path, file }),
  /** Keep one whole side of a conflicted file and stage it. */
  resolveConflict: (path: string, file: string, side: ConflictSide) => call<void>("resolve_conflict", { path, file, side }),
  writeFile: (path: string, file: string, content: string) => call<void>("write_file", { path, file, content }),
  createTag: (path: string, name: string, target: string | null, message: string | null) =>
    call<void>("create_tag", { path, name, target, message }),
  deleteTag: (path: string, name: string) => call<void>("delete_tag", { path, name }),
  stash: (path: string, message: string, includeUntracked: boolean) =>
    call<void>("stash_save", { path, message, includeUntracked }),
  stashPop: (path: string) => call<void>("stash_pop", { path }),

  initRepo: (path: string) => call<void>("init_repo", { path }),
  cloneRepo: (url: string, dest: string) => call<string>("clone_repo", { url, dest }),

  stagedDiff: (path: string) => call<string>("get_staged_diff", { path }),
  workingDiff: (path: string) => call<string>("get_working_diff", { path }),
  commitPatch: (path: string, hash: string) => call<string>("get_commit_patch", { path, hash }),

  tree: (path: string) => call<TreeEntry[]>("list_tree", { path }),
  readFile: (path: string, file: string) => call<FileContent>("read_file", { path, file }),
  /** Raw bytes as base64, for previewing images and PDFs. */
  readFileBase64: (path: string, file: string) => call<string>("read_file_base64", { path, file }),
  createFile: (path: string, file: string) => call<void>("create_file", { path, file }),
  createFolder: (path: string, folder: string) => call<void>("create_folder", { path, folder }),
  renamePath: (path: string, from: string, to: string) => call<void>("rename_path", { path, from, to }),
  deletePath: (path: string, target: string) => call<void>("delete_path", { path, target }),
};

/** On-disk storage for AI conversations, one file per repository. */
export const chatStore = {
  load: (repo: string) => call<string | null>("chats_load", { repo }),
  save: (repo: string, data: string) => call<void>("chats_save", { repo, data }),
};

export const ai = {
  setKey: (provider: AiProvider, key: string) => call<void>("ai_set_key", { provider, key }),
  hasKey: (provider: AiProvider) => call<boolean>("ai_has_key", { provider }),
  clearKey: (provider: AiProvider) => call<void>("ai_clear_key", { provider }),
  complete: (config: AiConfig, system: string, messages: ChatMessage[], effort: "low" | "medium" | "high", cwd: string | null) =>
    call<string>("ai_complete", { config, system, messages, effort, cwd }),
  listModels: (config: AiConfig) => call<string[]>("ai_list_models", { config }),
  cliVersion: (provider: AiProvider) => call<string | null>("ai_cli_version", { provider }),
};

/** Ask the user to pick a folder. Returns null when cancelled. */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return "/Users/demo/projects/aurora";
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false, title: "Open a Git repository" });
  return typeof selected === "string" ? selected : null;
}

/** Pick a parent folder for cloning or creating a repository. */
export async function pickDirectory(title: string): Promise<string | null> {
  if (!isTauri) return "/Users/demo/projects";
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}

/** Native confirmation dialog (falls back to `window.confirm` in the browser). */
export async function confirmAction(message: string, title = "Orbe", okLabel = "OK"): Promise<boolean> {
  if (!isTauri) return window.confirm(message);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(message, { title, kind: "warning", okLabel, cancelLabel: "Cancel" });
}

export const AUTHOR = { name: "Santiago Petean", site: "https://www.santiago-petean.com/" } as const;

/** Open the author's website in the default browser. */
export async function openAuthorSite() {
  if (!isTauri) {
    window.open(AUTHOR.site, "_blank", "noopener");
    return;
  }
  await invoke("open_author_site");
}

export async function windowAction(action: "minimize" | "toggleMaximize" | "close") {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow()[action]();
}

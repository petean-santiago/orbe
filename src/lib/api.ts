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
  fileDiff: (path: string, file: string, staged: boolean, untracked: boolean) =>
    call<string>("get_file_diff", { path, file, staged, untracked }),
  commitFiles: (path: string, hash: string) => call<FileChange[]>("get_commit_files", { path, hash }),
  commitFileDiff: (path: string, hash: string, file: string, oldPath: string | null) =>
    call<string>("get_commit_file_diff", { path, hash, file, oldPath }),
  stage: (path: string, files: string[]) => call<void>("stage_files", { path, files }),
  unstage: (path: string, files: string[]) => call<void>("unstage_files", { path, files }),
  discard: (path: string, tracked: string[], untracked: string[]) =>
    call<void>("discard_files", { path, tracked, untracked }),
  commit: (path: string, message: string, amend = false) =>
    call<string>("commit", { path, message, amend }),
  checkout: (path: string, name: string, remote: boolean) =>
    call<void>("checkout_branch", { path, name, remote }),
  fetch: (path: string) => call<void>("fetch", { path }),
  pull: (path: string) => call<void>("pull", { path }),
  push: (path: string) => call<void>("push", { path }),
};

/** Ask the user to pick a folder. Returns null when cancelled. */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return "/Users/demo/projects/aurora";
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false, title: "Open a Git repository" });
  return typeof selected === "string" ? selected : null;
}

/** Native confirmation dialog (falls back to `window.confirm` in the browser). */
export async function confirmAction(message: string, title = "Orbe", okLabel = "OK"): Promise<boolean> {
  if (!isTauri) return window.confirm(message);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(message, { title, kind: "warning", okLabel, cancelLabel: "Cancel" });
}

export async function windowAction(action: "minimize" | "toggleMaximize" | "close") {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow()[action]();
}

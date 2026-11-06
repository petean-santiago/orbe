/**
 * Where the "before" and "after" versions of a changed image come from, for
 * the image diff. Each loader resolves to the file's bytes as base64; null
 * means that side doesn't exist (the image was added or deleted).
 */
import { git, type Commit, type FileChange } from "./api";

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "tif", "tiff", "svg"]);

export const isImage = (path: string) => IMAGE.has(path.split(".").pop()?.toLowerCase() ?? "");

export type Loader = (() => Promise<string>) | null;

/** A working-tree change: unstaged compares index → disk, staged compares HEAD → index. */
export function worktreeImage(repo: string, f: FileChange): { before: Loader; after: Loader } {
  const old = f.oldPath ?? f.path;
  const blob = (spec: string): Loader => () => git.blobBase64(repo, spec);
  if (f.staged) {
    return {
      before: f.status === "added" ? null : blob(`HEAD:${old}`),
      after: f.status === "deleted" ? null : blob(`:${f.path}`),
    };
  }
  return {
    before: f.status === "untracked" || f.status === "added" ? null : blob(`:${old}`),
    after: f.status === "deleted" ? null : () => git.readFileBase64(repo, f.path),
  };
}

/** A file changed in a commit: compares its first parent → the commit. */
export function commitImage(repo: string, commit: Commit, f: FileChange): { before: Loader; after: Loader } {
  const old = f.oldPath ?? f.path;
  const isRoot = commit.parents.length === 0;
  return {
    before: f.status === "added" || isRoot ? null : () => git.blobBase64(repo, `${commit.hash}^:${old}`),
    after: f.status === "deleted" ? null : () => git.blobBase64(repo, `${commit.hash}:${f.path}`),
  };
}

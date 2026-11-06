/**
 * User-facing flows: dialogs that collect input, confirmations, and the
 * context menus for branches, tags, commits and files. Components call these
 * so the same action behaves identically everywhere it appears.
 */
import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  Copy,
  Download,
  FilePlus,
  FileText,
  FolderOpen,
  FolderPlus,
  GitBranchPlus,
  GitMerge,
  History,
  Pencil,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "@lucide/svelte";
import { confirmAction, type Branch, type Commit, type TreeEntry } from "./api";
import { isMac, pathError, refNameError } from "./format";
import { app } from "./state.svelte";
import { ui, type MenuItem } from "./ui.svelte";
import { explainCommit } from "./assistant.svelte";

const copy = (text: string) => navigator.clipboard.writeText(text);

const joinPath = (dir: string | null | undefined, name: string) =>
  dir ? `${dir.replace(/\/+$/, "")}/${name.trim()}` : name.trim();

// ---------------------------------------------------------------------------
// Branches and tags
// ---------------------------------------------------------------------------

/** Create a branch from HEAD, or from `start` (a commit or another branch). */
export async function newBranch(start: { ref: string; label: string } | null = null, name = "") {
  const values = await ui.ask({
    title: "New branch",
    description: start ? `Starts at ${start.label}.` : `Starts at ${app.headBranch?.name ?? "the current commit"}.`,
    icon: GitBranchPlus,
    fields: [
      {
        key: "name",
        label: "Branch name",
        value: name,
        placeholder: "feature/my-idea",
        mono: true,
        validate: (v) =>
          refNameError(v) ??
          (app.branches.some((b) => b.kind === "local" && b.name === v.trim()) ? "A branch with this name already exists." : null),
      },
      { key: "checkout", label: "Switch to the new branch", kind: "checkbox", value: true },
    ],
    confirm: "Create branch",
  });
  if (!values) return;
  await app.active.createBranch(String(values.name).trim(), start?.ref ?? null, !!values.checkout);
}

export async function renameBranch(b: Branch) {
  const values = await ui.ask({
    title: "Rename branch",
    icon: Pencil,
    fields: [
      {
        key: "name",
        label: "New name",
        value: b.name,
        mono: true,
        validate: (v) =>
          refNameError(v) ??
          (v.trim() !== b.name && app.branches.some((x) => x.kind === "local" && x.name === v.trim())
            ? "A branch with this name already exists."
            : null),
      },
    ],
    confirm: "Rename",
  });
  const name = values && String(values.name).trim();
  if (name && name !== b.name) await app.active.renameBranch(b.name, name);
}

export async function deleteBranch(b: Branch) {
  if (b.kind === "remote") {
    const ok = await confirmAction(
      `Delete ${b.name} on the remote? Other people will lose access to this branch.`,
      "Delete remote branch",
      "Delete",
    );
    if (ok) await app.active.deleteRemoteBranch(b.name);
    return;
  }
  const values = await ui.ask({
    title: `Delete ${b.name}?`,
    description: "Commits that aren't on any other branch will become hard to find.",
    icon: Trash2,
    fields: [{ key: "force", label: "Delete even if it isn't merged", kind: "checkbox", value: false }],
    confirm: "Delete branch",
    danger: true,
  });
  if (values) await app.active.deleteBranch(b.name, !!values.force);
}

export async function mergeBranch(name: string) {
  const into = app.headBranch?.name ?? "the current branch";
  const ok = await confirmAction(`Merge ${name} into ${into}?`, "Merge", "Merge");
  if (ok) await app.active.merge(name);
}

export async function newTag(target: { ref: string; label: string } | null = null) {
  const values = await ui.ask({
    title: "New tag",
    description: `Tags ${target?.label ?? "the current commit"}.`,
    icon: Tag,
    fields: [
      {
        key: "name",
        label: "Tag name",
        placeholder: "v1.0.0",
        mono: true,
        validate: (v) =>
          refNameError(v, "Tag") ??
          (app.branches.some((b) => b.kind === "tag" && b.name === v.trim()) ? "A tag with this name already exists." : null),
      },
      { key: "message", label: "Message (optional)", kind: "textarea", placeholder: "Release notes, or leave empty" },
    ],
    confirm: "Create tag",
  });
  if (!values) return;
  const message = String(values.message ?? "").trim();
  await app.active.createTag(String(values.name).trim(), target?.ref ?? null, message || null);
}

export async function deleteTag(name: string) {
  if (await confirmAction(`Delete tag ${name}? This only removes it locally.`, "Delete tag", "Delete")) {
    await app.active.deleteTag(name);
  }
}

export async function stashChanges() {
  if (!app.status.length) {
    app.toast("info", "Nothing to stash", "Your working tree is clean.");
    return;
  }
  const values = await ui.ask({
    title: "Stash changes",
    description: "Put your uncommitted changes aside and get a clean working tree.",
    icon: Archive,
    fields: [
      { key: "message", label: "Description (optional)", placeholder: "WIP: new sidebar" },
      { key: "untracked", label: "Include new (untracked) files", kind: "checkbox", value: true },
    ],
    confirm: "Stash",
  });
  if (values) await app.active.stash(String(values.message ?? ""), !!values.untracked);
}

// ---------------------------------------------------------------------------
// Files and folders
// ---------------------------------------------------------------------------

export async function newFile(dir: string | null = null) {
  const values = await ui.ask({
    title: "New file",
    description: dir ? `Inside ${dir}/` : "Use slashes to create it inside folders, e.g. src/utils/math.ts",
    icon: FilePlus,
    fields: [{ key: "name", label: "File name", placeholder: "notes.md", mono: true, validate: (v) => pathError(v) }],
    confirm: "Create file",
  });
  if (values) await app.active.createFile(joinPath(dir, String(values.name)));
}

export async function newFolder(dir: string | null = null) {
  const values = await ui.ask({
    title: "New folder",
    description: dir ? `Inside ${dir}/` : "Use slashes to create nested folders, e.g. docs/guides",
    icon: FolderPlus,
    fields: [{ key: "name", label: "Folder name", placeholder: "docs", mono: true, validate: (v) => pathError(v) }],
    confirm: "Create folder",
  });
  if (values) await app.active.createFolder(joinPath(dir, String(values.name)));
}

export async function renamePath(entry: TreeEntry) {
  const values = await ui.ask({
    title: entry.dir ? "Rename folder" : "Rename file",
    icon: Pencil,
    fields: [{ key: "path", label: "New path", value: entry.path, mono: true, validate: (v) => pathError(v) }],
    confirm: "Rename",
  });
  const to = values && String(values.path).trim();
  if (to && to !== entry.path) await app.active.renamePath(entry.path, to);
}

export async function deletePath(entry: TreeEntry) {
  const what = entry.dir ? `the folder ${entry.path} and everything in it` : entry.path;
  if (await confirmAction(`Move ${what} to the trash?`, "Delete", "Move to trash")) {
    await app.active.deletePath(entry.path);
  }
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

function repoNameFromUrl(url: string): string {
  return (
    url
      .trim()
      .replace(/[\\/]+$/, "")
      .split(/[\\/:]/)
      .pop()
      ?.replace(/\.git$/, "") ?? ""
  );
}

export async function cloneRepository() {
  const values = await ui.ask({
    title: "Clone repository",
    description: "Copy a repository from GitHub, GitLab or any Git server.",
    icon: Download,
    fields: [
      {
        key: "url",
        label: "Repository URL",
        placeholder: "https://github.com/user/project.git",
        mono: true,
        validate: (v) => (v.trim() ? null : "Paste the URL of the repository."),
      },
      {
        key: "parent",
        label: "Clone into",
        kind: "folder",
        placeholder: "Choose a folder…",
        validate: (v) => (v.trim() ? null : "Choose where to put it."),
      },
      {
        key: "name",
        label: "Folder name",
        placeholder: "Defaults to the repository name",
        mono: true,
        validate: (v, all) => (v.trim() || repoNameFromUrl(String(all.url)) ? pathError(v.trim() || "x") : "Enter a folder name."),
      },
    ],
    confirm: "Clone",
  });
  if (!values) return;
  const url = String(values.url).trim();
  const name = String(values.name).trim() || repoNameFromUrl(url);
  const parent = String(values.parent).replace(/[\\/]+$/, "");
  const sep = parent.includes("\\") ? "\\" : "/";
  await app.cloneRepo(url, `${parent}${sep}${name}`);
}

export async function createRepository() {
  const values = await ui.ask({
    title: "New repository",
    description: "Create an empty Git repository in a new or existing folder.",
    icon: FolderPlus,
    fields: [
      { key: "parent", label: "Location", kind: "folder", placeholder: "Choose a folder…", validate: (v) => (v.trim() ? null : "Choose a location.") },
      { key: "name", label: "Name", placeholder: "my-project", mono: true, validate: (v) => pathError(v) },
    ],
    confirm: "Create repository",
  });
  if (!values) return;
  const parent = String(values.parent).replace(/[\\/]+$/, "");
  const sep = parent.includes("\\") ? "\\" : "/";
  await app.initRepo(`${parent}${sep}${String(values.name).trim()}`);
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

/** Everything the "New" toolbar button offers. */
export function createMenuItems(): MenuItem[] {
  const repo = !!app.repo;
  return [
    { header: "In this repository" },
    { label: "Branch…", icon: GitBranchPlus, hint: isMac ? "⇧⌘B" : "Ctrl+Shift+B", run: () => newBranch(), disabled: !repo },
    { label: "Tag…", icon: Tag, run: () => newTag(), disabled: !repo },
    { label: "File…", icon: FilePlus, run: () => newFile(), disabled: !repo },
    { label: "Folder…", icon: FolderPlus, run: () => newFolder(), disabled: !repo },
    { separator: true },
    { label: "Stash changes…", icon: Archive, run: () => stashChanges(), disabled: !repo },
    { label: "Apply latest stash", icon: ArchiveRestore, run: () => app.active.stashPop(), disabled: !repo },
    { separator: true },
    { header: "Repositories" },
    { label: "Clone repository…", icon: Download, run: () => cloneRepository() },
    { label: "New repository…", icon: FolderPlus, run: () => createRepository() },
    { label: "Open repository…", icon: FolderOpen, run: () => app.openFolder() },
  ];
}

export function branchMenu(b: Branch): MenuItem[] {
  const head = app.headBranch?.name;
  if (b.kind === "tag") {
    return [
      { header: b.name },
      { label: "New branch from this tag…", icon: GitBranchPlus, run: () => newBranch({ ref: b.name, label: `tag ${b.name}` }) },
      { label: "Copy name", icon: Copy, run: () => copy(b.name) },
      { separator: true },
      { label: "Delete tag", icon: Trash2, danger: true, run: () => deleteTag(b.name) },
    ];
  }
  const items: MenuItem[] = [{ header: b.name }];
  if (!b.isHead) items.push({ label: "Switch to this branch", icon: ArrowRightLeft, run: () => app.checkout(b) });
  items.push({ label: "New branch from here…", icon: GitBranchPlus, run: () => newBranch({ ref: b.name, label: b.name }) });
  if (!b.isHead && head) items.push({ label: `Merge into ${head}`, icon: GitMerge, run: () => mergeBranch(b.name) });
  items.push({ label: "New tag here…", icon: Tag, run: () => newTag({ ref: b.name, label: b.name }) });
  items.push({ separator: true });
  if (b.kind === "local") items.push({ label: "Rename…", icon: Pencil, run: () => renameBranch(b) });
  items.push({ label: "Copy name", icon: Copy, run: () => copy(b.name) });
  if (!b.isHead) {
    items.push({ separator: true });
    items.push({
      label: b.kind === "remote" ? "Delete from remote…" : "Delete…",
      icon: Trash2,
      danger: true,
      run: () => deleteBranch(b),
    });
  }
  return items;
}

/** Local branches whose tip is this commit (other than the current one). */
function branchesAt(c: Commit) {
  return app.branches.filter(
    (b) => b.kind === "local" && !b.isHead && c.refs.some((r) => r === b.name || r === `HEAD -> ${b.name}`),
  );
}

/** Double-click on a commit: go back to it, like other Git clients. */
export function checkoutMenu(c: Commit): MenuItem[] {
  const isHere = app.active.headCommit?.hash === c.hash;
  const items: MenuItem[] = [{ header: `${c.shortHash}  ·  ${c.subject.length > 42 ? c.subject.slice(0, 40) + "…" : c.subject}` }];
  for (const b of branchesAt(c).slice(0, 3)) {
    items.push({ label: `Switch to ${b.name}`, icon: ArrowRightLeft, run: () => app.checkout(b) });
  }
  items.push({
    label: isHere ? "You're on this commit" : "Check out this commit",
    icon: History,
    hint: isHere ? undefined : "detached HEAD",
    disabled: isHere,
    run: () => app.active.checkoutCommit(c),
  });
  items.push({
    label: "New branch here and switch…",
    icon: GitBranchPlus,
    run: () => newBranch({ ref: c.hash, label: `commit ${c.shortHash}` }),
  });
  items.push({ separator: true }, { label: "Cancel", icon: X, run: () => {} });
  return items;
}

export function commitMenu(c: Commit): MenuItem[] {
  const ref = { ref: c.hash, label: `commit ${c.shortHash}` };
  return [
    { header: c.shortHash },
    {
      label: "Check out this commit",
      icon: History,
      hint: "detached",
      disabled: app.active.headCommit?.hash === c.hash,
      run: () => app.active.checkoutCommit(c),
    },
    { label: "New branch here…", icon: GitBranchPlus, run: () => newBranch(ref) },
    { label: "New tag here…", icon: Tag, run: () => newTag(ref) },
    { label: "Explain with AI", icon: Sparkles, run: () => explainCommit(app.active, c) },
    { separator: true },
    { label: "Copy hash", icon: Copy, run: () => copy(c.hash) },
    { label: "Copy message", icon: Copy, run: () => copy(c.subject) },
  ];
}

export function fileMenu(entry: TreeEntry | null): MenuItem[] {
  const dir = entry ? (entry.dir ? entry.path : entry.path.split("/").slice(0, -1).join("/") || null) : null;
  const items: MenuItem[] = [
    { label: "New file…", icon: FilePlus, run: () => newFile(dir) },
    { label: "New folder…", icon: FolderPlus, run: () => newFolder(dir) },
  ];
  if (!entry) return items;
  const change = app.status.find((s) => s.path === entry.path);
  items.unshift({ header: entry.path.split("/").pop() ?? entry.path });
  items.push({ separator: true });
  if (change) {
    items.push({
      label: "Show changes",
      icon: FileText,
      run: () => {
        app.selectedChange = change;
        app.view = "changes";
      },
    });
  }
  items.push({ label: "Copy path", icon: Copy, run: () => copy(entry.path) });
  items.push({ label: "Rename…", icon: Pencil, run: () => renamePath(entry) });
  items.push({ separator: true });
  items.push({ label: "Move to trash", icon: Trash2, danger: true, run: () => deletePath(entry) });
  return items;
}


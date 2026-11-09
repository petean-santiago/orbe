/**
 * Tab groups: dialogs and context menus for grouping related repositories.
 * The state lives in `app` (state.svelte.ts); this is the user-facing layer.
 */
import { FolderOpen, FolderPlus, Layers, ListChecks, LogOut, Pencil, Plus, Trash2, X } from "@lucide/svelte";
import { app, GROUP_COLORS, type GroupColor, type RepoTab, type TabGroup } from "./state.svelte";
import { ui, type ChecklistOption, type MenuItem } from "./ui.svelte";

export const groupLabel = (g: TabGroup) => g.name || "Untitled group";

const repoName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const COLOR_NAMES: Record<GroupColor, string> = {
  violet: "Violet",
  blue: "Blue",
  cyan: "Cyan",
  green: "Green",
  yellow: "Yellow",
  orange: "Orange",
  rose: "Rose",
  grey: "Grey",
};

/** Every repository we know about: open tabs first, then recents, then other groups. */
function knownRepos(extra: string[] = []): ChecklistOption[] {
  const paths = [
    ...extra,
    ...app.tabs.map((t) => t.repo?.path).filter((p): p is string => !!p),
    ...app.recents.map((r) => r.path),
    ...app.groups.flatMap((g) => g.paths),
  ];
  return [...new Set(paths)].map((p) => ({ value: p, label: repoName(p), hint: p }));
}

async function askGroup(opts: { title: string; confirm: string; name?: string; paths: string[]; danger?: boolean }) {
  const values = await ui.ask({
    title: opts.title,
    description: "Pick the repositories that belong together. They'll open side by side, and the group is saved.",
    icon: Layers,
    fields: [
      {
        key: "name",
        label: "Group name",
        value: opts.name ?? "",
        placeholder: "e.g. Client work",
        validate: (v) => (v.trim() ? null : "Give the group a name."),
      },
      { key: "repos", label: "Repositories", kind: "checklist", options: knownRepos(opts.paths), value: opts.paths, browse: true, min: 1 },
    ],
    confirm: opts.confirm,
  });
  return values ? { name: String(values.name), paths: values.repos as string[] } : null;
}

/** Ask for a name and the repositories, then create and open the group. */
export async function newGroup(tab?: RepoTab) {
  const preselect = tab?.repo ? [tab.repo.path] : [];
  const result = await askGroup({ title: "New group", confirm: "Create group", paths: preselect });
  if (result) await app.createGroup(result.name, result.paths);
}

export async function editGroup(g: TabGroup) {
  const result = await askGroup({ title: "Edit group", confirm: "Save", name: g.name, paths: [...g.paths] });
  if (result) await app.editGroup(g.id, result.name, result.paths);
}

export async function renameGroup(g: TabGroup) {
  const values = await ui.ask({
    title: "Rename group",
    icon: Pencil,
    fields: [{ key: "name", label: "Group name", value: g.name, validate: (v) => (v.trim() ? null : "Give the group a name.") }],
    confirm: "Rename",
  });
  if (values) app.updateGroup(g.id, { name: String(values.name).trim() });
}

/** Groups are kept until deleted on purpose, so deleting always asks. */
export async function deleteGroup(g: TabGroup) {
  const n = g.paths.length;
  const ok = await ui.ask({
    title: `Delete ${groupLabel(g)}?`,
    description: `The group and its list of ${n} repositor${n === 1 ? "y" : "ies"} will be forgotten. Nothing is deleted from disk, and open tabs stay open.`,
    icon: Trash2,
    fields: [],
    confirm: "Delete group",
    danger: true,
  });
  if (ok) app.deleteGroup(g.id);
}

function colorRow(g: TabGroup): MenuItem {
  return {
    swatches: (Object.keys(GROUP_COLORS) as GroupColor[]).map((c) => ({
      color: GROUP_COLORS[c],
      label: COLOR_NAMES[c],
      active: g.color === c,
      run: () => app.updateGroup(g.id, { color: c }),
    })),
  };
}

/** Right-click menu for a tab. */
export function tabMenu(e: MouseEvent, tab: RepoTab) {
  const current = app.groupOf(tab);
  const others = app.groups.filter((g) => g.id !== current?.id);
  const items: MenuItem[] = [{ label: "Add to new group…", icon: FolderPlus, run: () => newGroup(tab) }];
  if (others.length) {
    items.push({ header: current ? "Move to group" : "Add to group" });
    for (const g of others) items.push({ label: groupLabel(g), icon: Layers, run: () => app.addToGroup(tab, g.id) });
  }
  if (current) items.push({ label: "Remove from group", icon: LogOut, run: () => app.removeFromGroup(tab) });
  items.push({ separator: true }, { label: "Close tab", icon: X, run: () => app.closeTab(tab.id) });
  ui.menuAt(e, items);
}

/** Right-click menu for a group's chip in the tab bar. */
export function groupMenu(e: MouseEvent, g: TabGroup) {
  ui.menuAt(e, [
    { header: groupLabel(g) },
    colorRow(g),
    { separator: true },
    { label: "Edit repositories…", icon: ListChecks, run: () => editGroup(g) },
    { label: "Rename…", icon: Pencil, run: () => renameGroup(g) },
    { label: "Open repository in group…", icon: FolderOpen, run: () => app.openFolderInGroup(g.id) },
    { label: "New tab in group", icon: Plus, run: () => app.newTabInGroup(g.id) },
    { separator: true },
    { label: "Close group", icon: X, hint: "Stays saved", run: () => app.closeGroup(g.id) },
    { label: "Delete group…", icon: Trash2, danger: true, run: () => deleteGroup(g) },
  ]);
}

/** Right-click menu for a saved group on the start screen. */
export function savedGroupMenu(e: MouseEvent, g: TabGroup) {
  ui.menuAt(e, [
    { header: groupLabel(g) },
    colorRow(g),
    { separator: true },
    { label: "Open all", icon: FolderOpen, disabled: !g.paths.length, run: () => app.openGroup(g.id) },
    { label: "Edit repositories…", icon: ListChecks, run: () => editGroup(g) },
    { label: "Rename…", icon: Pencil, run: () => renameGroup(g) },
    { separator: true },
    { label: "Delete group…", icon: Trash2, danger: true, run: () => deleteGroup(g) },
  ]);
}

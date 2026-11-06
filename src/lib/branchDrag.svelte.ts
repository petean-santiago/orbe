/**
 * Drag a branch onto another branch to merge or rebase, like GitKraken/Fork.
 *
 * Pointer events instead of the HTML5 drag API (Tauri intercepts native drag
 * events on Windows). A drag only starts after the pointer moves a few pixels,
 * so clicks and double-clicks on branches keep working.
 *
 * Drop targets are any element with `data-branch-drop="<local branch name>"`:
 * sidebar branch rows, the toolbar's current-branch button and branch pills in
 * the history.
 */
import { GitMerge, GitPullRequestArrow, X } from "@lucide/svelte";
import type { Branch } from "./api";
import { app } from "./state.svelte";
import { ui, type MenuItem } from "./ui.svelte";

const THRESHOLD = 6;

class BranchDrag {
  source = $state<Branch | null>(null);
  target = $state<Branch | null>(null);
  x = $state(0);
  y = $state(0);
}

export const branchDrag = new BranchDrag();

/** The local branch under the pointer that `source` could be dropped on. */
function targetAt(x: number, y: number, source: Branch): Branch | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-branch-drop]");
  const name = el?.dataset.branchDrop;
  if (!name) return null;
  const target = app.branches.find((b) => b.kind === "local" && b.name === name) ?? null;
  // Not onto itself, nor a local branch onto its own remote twin.
  if (!target || target.name === source.name || (source.kind === "remote" && target.upstream === source.name)) return null;
  return target;
}

function dropMenu(source: Branch, target: Branch): MenuItem[] {
  const switches = !target.isHead;
  const items: MenuItem[] = [
    { header: `${source.name}  →  ${target.name}` },
    {
      label: `Merge ${source.name} into ${target.name}`,
      icon: GitMerge,
      hint: switches ? "switches branch" : undefined,
      run: () => app.active.mergeInto(source.name, target.name),
    },
  ];
  if (source.kind === "local") {
    items.push({
      label: `Rebase ${source.name} onto ${target.name}`,
      icon: GitPullRequestArrow,
      hint: source.isHead ? undefined : "switches branch",
      run: () => app.active.rebaseOnto(source.name, target.name),
    });
  }
  items.push({ separator: true }, { label: "Cancel", icon: X, run: () => {} });
  return items;
}

export function startBranchDrag(e: PointerEvent, source: Branch) {
  if (e.button !== 0 || source.kind === "tag" || !app.repo) return;
  if ((e.target as HTMLElement).closest("button, [data-no-drag]")) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let started = false;

  const move = (ev: PointerEvent) => {
    if (!started) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return;
      started = true;
      branchDrag.source = source;
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    }
    branchDrag.x = ev.clientX;
    branchDrag.y = ev.clientY;
    branchDrag.target = targetAt(ev.clientX, ev.clientY, source);
  };

  const end = (ev: PointerEvent, cancelled: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", esc);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (!started) return;
    const target = branchDrag.target;
    branchDrag.source = null;
    branchDrag.target = null;
    // The click that ends a drag shouldn't also select the row underneath.
    const swallow = (ce: Event) => {
      ce.stopPropagation();
      ce.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    if (!cancelled && target) ui.menu = { x: ev.clientX, y: ev.clientY, items: dropMenu(source, target) };
  };
  const up = (ev: PointerEvent) => end(ev, false);
  const cancel = (ev: PointerEvent) => end(ev, true);
  const esc = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && started) end(new PointerEvent("pointerup"), true);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", esc);
}

/** Is `name` the branch currently under the dragged one? (for drop highlighting) */
export const isDropTarget = (name: string) => branchDrag.target?.name === name;

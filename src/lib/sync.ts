/**
 * Per-commit sync state for the history list, derived from the commit graph:
 *
 * - "push":   on a local branch but not on any remote yet (you haven't pushed it)
 * - "pull":   on a branch's upstream but not on the local branch (you haven't pulled it)
 * - "synced": already on a remote
 *
 * Commits that only exist on remote branches you don't track get no state.
 */
import type { Branch, Commit } from "./api";

export type SyncState = "push" | "pull" | "synced";

/** Map every ref name ("main", "origin/main", ...) to the commit it points at. */
function refTargets(commits: Commit[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of commits) {
    for (const r of c.refs) {
      if (r.startsWith("tag: ")) continue;
      map.set(r.startsWith("HEAD -> ") ? r.slice(8) : r, c.hash);
    }
  }
  return map;
}

/** Every commit reachable from `starts` (following parents within the loaded history). */
function reachable(starts: (string | undefined)[], parents: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = starts.filter((s): s is string => !!s);
  while (stack.length) {
    const h = stack.pop()!;
    if (seen.has(h)) continue;
    seen.add(h);
    for (const p of parents.get(h) ?? []) if (!seen.has(p)) stack.push(p);
  }
  return seen;
}

export function computeSync(commits: Commit[], branches: Branch[]): Map<string, SyncState> {
  const out = new Map<string, SyncState>();
  if (!commits.length) return out;

  const parents = new Map(commits.map((c) => [c.hash, c.parents]));
  const at = refTargets(commits);
  const locals = branches.filter((b) => b.kind === "local");
  const remotes = branches.filter((b) => b.kind === "remote");

  const onRemote = reachable(remotes.map((b) => at.get(b.name)), parents);
  const onLocal = reachable(locals.map((b) => at.get(b.name)), parents);

  for (const h of onRemote) out.set(h, "synced");
  // Local work not on any remote yet.
  for (const h of onLocal) if (!onRemote.has(h)) out.set(h, "push");
  // Commits on a tracked upstream that its local branch doesn't have yet.
  for (const b of locals) {
    if (!b.upstream || !b.behind) continue;
    const upstream = reachable([at.get(b.upstream)], parents);
    const local = reachable([at.get(b.name)], parents);
    for (const h of upstream) if (!local.has(h)) out.set(h, "pull");
  }
  return out;
}

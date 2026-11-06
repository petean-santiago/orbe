import type { FileStatus } from "./api";

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function relativeTime(unixSeconds: number): string {
  const diff = unixSeconds - Date.now() / 1000;
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (abs >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return "just now";
}

export function shortDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function fullDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Stable, pleasant hue per author. */
export function avatarHue(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf("/");
  return i === -1 ? { dir: "", name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}

export const STATUS_META: Record<FileStatus, { letter: string; label: string; color: string }> = {
  added: { letter: "A", label: "Added", color: "var(--color-added)" },
  untracked: { letter: "U", label: "Untracked", color: "var(--color-added)" },
  modified: { letter: "M", label: "Modified", color: "var(--color-modified)" },
  deleted: { letter: "D", label: "Deleted", color: "var(--color-deleted)" },
  renamed: { letter: "R", label: "Renamed", color: "var(--color-renamed)" },
  copied: { letter: "C", label: "Copied", color: "var(--color-renamed)" },
  typechange: { letter: "T", label: "Type changed", color: "var(--color-modified)" },
  conflicted: { letter: "!", label: "Conflicted", color: "var(--color-conflict)" },
};

export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
export const modKey = isMac ? "⌘" : "Ctrl";

/** Why `name` can't be a Git branch or tag name, or null if it's fine. */
export function refNameError(name: string, what = "Branch"): string | null {
  const n = name.trim();
  if (!n) return `${what} name is required.`;
  if (/\s/.test(n)) return "Spaces aren't allowed — try a dash instead.";
  if (/[~^:?*[\\]/.test(n)) return "These characters aren't allowed: ~ ^ : ? * [ \\";
  if (n.includes("..") || n.includes("@{") || n.includes("//")) return `That isn't a valid ${what.toLowerCase()} name.`;
  if (n.startsWith("-") || n.startsWith("/") || n.endsWith("/") || n.endsWith(".") || n.endsWith(".lock") || n === "@")
    return `That isn't a valid ${what.toLowerCase()} name.`;
  return null;
}

/** Why `path` can't be used for a new file or folder, or null if it's fine. */
export function pathError(path: string): string | null {
  const p = path.trim();
  if (!p) return "A name is required.";
  if (p.split(/[\\/]/).some((part) => part === "..")) return "Paths must stay inside the repository.";
  if (/^[a-zA-Z]:|^[\\/]/.test(p)) return "Use a path relative to the repository.";
  if (/[<>:"|?*]/.test(p)) return 'These characters aren\'t allowed: < > : " | ? *';
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Fuzzy match: the indices of `query`'s characters in `text`, or null.
 * A contiguous match is preferred; otherwise any in-order subsequence.
 */
export function fuzzyMatch(text: string, query: string): number[] | null {
  const q = query.toLowerCase();
  if (!q) return [];
  const lower = text.toLowerCase();
  const at = lower.indexOf(q);
  if (at !== -1) return Array.from({ length: q.length }, (_, i) => at + i);
  const hits: number[] = [];
  let j = 0;
  for (let i = 0; i < lower.length && j < q.length; i++) {
    if (lower[i] === q[j]) {
      hits.push(i);
      j++;
    }
  }
  return j === q.length ? hits : null;
}

/** Lower is better: contiguous hits near the start rank first. */
export function matchScore(hits: number[]): number {
  if (!hits.length) return 0;
  const span = hits[hits.length - 1] - hits[0] + 1;
  return (span - hits.length) * 10 + hits[0];
}

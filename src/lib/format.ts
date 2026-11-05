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

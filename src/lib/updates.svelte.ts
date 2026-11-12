/**
 * New-version notice. Twice a day (and on demand from Settings) Orbe reads
 * the `latest.json` the website publishes; when it lists a newer version, a
 * small "Update" pill appears in the title bar with what's new and a link to
 * the download. Nothing is installed automatically.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri, openUrl } from "./api";

export interface Release {
  version: string;
  date: string | null;
  notes: string[];
  url: string;
}

const KEY = "orbe.updates";
const EVERY_MS = 12 * 60 * 60 * 1000;

interface Stored {
  lastCheck: number;
  /** Version the user chose to skip. */
  skipped: string | null;
  latest: Release | null;
}

function load(): Stored {
  try {
    return { lastCheck: 0, skipped: null, latest: null, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { lastCheck: 0, skipped: null, latest: null };
  }
}

/** -1, 0 or 1, comparing "1.2.10" style versions (pre-release tags sort before the release). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

class Updates {
  current = $state<string | null>(null);
  latest = $state<Release | null>(null);
  checking = $state(false);
  /** Result of the last check started from Settings, for its status line. */
  status = $state<string | null>(null);
  dialogOpen = $state(false);
  private stored = load();
  private skipped = $state<string | null>(this.stored.skipped);

  constructor() {
    this.latest = this.stored.latest;
  }

  /** A newer version the user hasn't skipped. */
  get available(): Release | null {
    const l = this.latest;
    if (!l || !this.current || compareVersions(l.version, this.current) <= 0) return null;
    return this.skipped === l.version ? null : l;
  }

  async init() {
    if (!isTauri) return;
    this.current = await invoke<string>("app_version").catch(() => null);
  }

  /** Check if it's been a while (or always, when `manual`). */
  async check(manual = false) {
    if (!isTauri || this.checking) return;
    if (!manual && Date.now() - this.stored.lastCheck < EVERY_MS) return;
    this.checking = true;
    if (manual) this.status = null;
    try {
      const r = await invoke<{ current: string; latest: Release }>("check_for_update");
      this.current = r.current;
      this.latest = r.latest;
      this.save({ lastCheck: Date.now(), latest: r.latest });
      if (manual) {
        if (this.stored.skipped === r.latest.version) this.save({ skipped: null }); // asked explicitly: show it again
        this.status = compareVersions(r.latest.version, r.current) > 0 ? `Orbe ${r.latest.version} is available.` : `You're on the latest version (${r.current}).`;
      }
    } catch (e) {
      if (manual) this.status = String(e);
    } finally {
      this.checking = false;
    }
  }

  skip() {
    if (this.latest) this.save({ skipped: this.latest.version });
    this.dialogOpen = false;
  }

  download() {
    const l = this.available ?? this.latest;
    if (l) void openUrl(l.url);
  }

  private save(patch: Partial<Stored>) {
    this.stored = { ...this.stored, ...patch };
    this.skipped = this.stored.skipped;
    localStorage.setItem(KEY, JSON.stringify(this.stored));
  }
}

export const updates = new Updates();

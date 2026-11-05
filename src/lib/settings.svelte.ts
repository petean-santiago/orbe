/**
 * User preferences. Persisted to localStorage and applied live through CSS
 * variables / data attributes on <html>, so every change previews instantly.
 */

export type SidebarSectionId = "workspace" | "branches" | "remotes" | "tags";
export type ColumnId = "graph" | "description" | "author" | "date" | "hash";
export type ToolbarItemId = "branch" | "search" | "fetch" | "pull" | "push";

export interface Toggleable<T extends string> {
  id: T;
  visible: boolean;
}

export interface Settings {
  accent: keyof typeof ACCENTS;
  uiFont: keyof typeof UI_FONTS;
  monoFont: keyof typeof MONO_FONTS;
  /** Interface zoom, 0.85 – 1.25 */
  scale: number;
  density: "compact" | "comfortable";
  glass: "frosted" | "clear" | "solid";
  ambient: boolean;
  sidebarSide: "left" | "right";
  detailsPosition: "bottom" | "right";
  relativeDates: boolean;
  showAvatars: boolean;
  sidebarSections: Toggleable<SidebarSectionId>[];
  columns: Toggleable<ColumnId>[];
  toolbar: Toggleable<ToolbarItemId>[];
}

export const ACCENTS = {
  fuchsia: { label: "Fuchsia", hue: 330 },
  magenta: { label: "Magenta", hue: 350 },
  violet: { label: "Violet", hue: 295 },
  indigo: { label: "Indigo", hue: 270 },
  cyan: { label: "Cyan", hue: 210 },
  emerald: { label: "Emerald", hue: 160 },
  amber: { label: "Amber", hue: 70 },
  coral: { label: "Coral", hue: 25 },
} as const;

export const UI_FONTS = {
  bricolage: { label: "Bricolage Grotesque", family: '"Bricolage Grotesque Variable"', note: "Characterful, compact" },
  onest: { label: "Onest", family: '"Onest Variable"', note: "Clean and modern" },
  manrope: { label: "Manrope", family: '"Manrope Variable"', note: "Soft geometric" },
  space: { label: "Space Grotesk", family: '"Space Grotesk Variable"', note: "Techy, quirky" },
  sora: { label: "Sora", family: '"Sora Variable"', note: "Wide, futuristic" },
} as const;

export const MONO_FONTS = {
  commit: { label: "Commit Mono", family: '"Commit Mono"' },
  jetbrains: { label: "JetBrains Mono", family: '"JetBrains Mono Variable"' },
  geist: { label: "Geist Mono", family: '"Geist Mono Variable"' },
} as const;

export const SECTION_LABELS: Record<SidebarSectionId, string> = {
  workspace: "Changes & History",
  branches: "Branches",
  remotes: "Remotes",
  tags: "Tags",
};

export const COLUMN_LABELS: Record<ColumnId, string> = {
  graph: "Graph",
  description: "Description",
  author: "Author",
  date: "Date",
  hash: "Commit",
};

export const TOOLBAR_LABELS: Record<ToolbarItemId, string> = {
  branch: "Current branch",
  search: "Search",
  fetch: "Fetch",
  pull: "Pull",
  push: "Push",
};

/** Items that must always stay visible. */
export const LOCKED = new Set<string>(["description"]);

const DEFAULTS: Settings = {
  accent: "fuchsia",
  uiFont: "bricolage",
  monoFont: "commit",
  scale: 1,
  density: "comfortable",
  glass: "frosted",
  ambient: true,
  sidebarSide: "left",
  detailsPosition: "bottom",
  relativeDates: true,
  showAvatars: true,
  sidebarSections: [
    { id: "workspace", visible: true },
    { id: "branches", visible: true },
    { id: "remotes", visible: true },
    { id: "tags", visible: true },
  ],
  columns: [
    { id: "graph", visible: true },
    { id: "description", visible: true },
    { id: "author", visible: true },
    { id: "date", visible: true },
    { id: "hash", visible: true },
  ],
  toolbar: [
    { id: "branch", visible: true },
    { id: "search", visible: true },
    { id: "fetch", visible: true },
    { id: "pull", visible: true },
    { id: "push", visible: true },
  ],
};

const KEY = "orbe.settings";

/** Merge stored lists with defaults so new items added in updates still appear. */
function mergeList<T extends string>(stored: Toggleable<T>[] | undefined, defaults: Toggleable<T>[]) {
  if (!Array.isArray(stored)) return structuredClone(defaults);
  const known = new Set(defaults.map((d) => d.id));
  const kept = stored.filter((s) => known.has(s.id));
  const missing = defaults.filter((d) => !kept.some((k) => k.id === d.id));
  return [...kept, ...structuredClone(missing)];
}

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    const merged = { ...structuredClone(DEFAULTS), ...raw };
    if (!(merged.accent in ACCENTS)) merged.accent = DEFAULTS.accent;
    if (!(merged.uiFont in UI_FONTS)) merged.uiFont = DEFAULTS.uiFont;
    if (!(merged.monoFont in MONO_FONTS)) merged.monoFont = DEFAULTS.monoFont;
    merged.scale = Math.min(1.25, Math.max(0.85, Number(merged.scale) || 1));
    merged.sidebarSections = mergeList(raw.sidebarSections, DEFAULTS.sidebarSections);
    merged.columns = mergeList(raw.columns, DEFAULTS.columns);
    merged.toolbar = mergeList(raw.toolbar, DEFAULTS.toolbar);
    return merged;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

let lastScale = 1;
async function applyScale(scale: number) {
  if (scale === lastScale) return;
  lastScale = scale;
  if ("__TAURI_INTERNALS__" in window) {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(scale);
  } else {
    document.documentElement.style.setProperty("zoom", String(scale));
  }
}

class SettingsStore {
  value = $state<Settings>(load());

  /** Commit-list row height for the chosen density. */
  rowHeight = $derived(this.value.density === "compact" ? 30 : 36);

  reset() {
    this.value = structuredClone(DEFAULTS);
  }

  /** Persist + apply; call once from the root component inside an $effect. */
  apply() {
    const s = this.value;
    localStorage.setItem(KEY, JSON.stringify(s));
    const root = document.documentElement;
    root.style.setProperty("--accent-h", String(ACCENTS[s.accent].hue));
    root.style.setProperty("--font-sans", `${UI_FONTS[s.uiFont].family}, ui-sans-serif, system-ui, sans-serif`);
    root.style.setProperty("--font-mono", `${MONO_FONTS[s.monoFont].family}, ui-monospace, Consolas, monospace`);
    applyScale(s.scale);
    root.dataset.glass = s.glass;
    root.dataset.density = s.density;
  }
}

export const settings = new SettingsStore();

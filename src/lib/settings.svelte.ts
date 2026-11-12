import type { AiConfig, AiProvider } from "./api";

/**
 * User preferences. Persisted to localStorage and applied live through CSS
 * variables / data attributes on <html>, so every change previews instantly.
 */

export type SidebarSectionId = "workspace" | "branches" | "remotes" | "tags";
export type ColumnId = "graph" | "description" | "author" | "date" | "hash";
export type ToolbarItemId =
  | "branch"
  | "create"
  | "search"
  | "assistant"
  | "fetch"
  | "pull"
  | "push";

export interface Toggleable<T extends string> {
  id: T;
  visible: boolean;
}

export interface Settings {
  /** Bumped when a default changes and existing users should get it too. */
  version: number;
  accent: keyof typeof ACCENTS;
  uiFont: keyof typeof UI_FONTS;
  /** Font for titles and headings: where Orbe shows its personality. */
  titleFont: keyof typeof TITLE_FONTS;
  monoFont: keyof typeof MONO_FONTS;
  /** Interface zoom, 0.85 – 1.25 */
  scale: number;
  density: "compact" | "comfortable";
  glass: "frosted" | "clear" | "solid";
  ambient: boolean;
  /** Slow drifting of the ambient glows ("breathing"). */
  ambientMotion: boolean;
  sidebarSide: "left" | "right";
  /** "auto" shows icons only when the window is narrow. */
  sidebarMode: "auto" | "open" | "icons";
  detailsPosition: "bottom" | "right";
  relativeDates: boolean;
  /** Text diffs: one column, or old and new side by side. */
  diffMode: "unified" | "split";
  /** Hide changes that are only whitespace / indentation. */
  diffIgnoreWhitespace: boolean;
  /** Minutes between background fetches (0 = never), so "to pull" counts stay current. */
  autoFetch: number;
  /** Look for a newer Orbe on the website twice a day. */
  checkUpdates: boolean;
  showAvatars: boolean;
  /** Panel sizes the user dragged: pixels, or fractions for the split panes. */
  sizes: PanelSizes;
  sidebarSections: Toggleable<SidebarSectionId>[];
  columns: Toggleable<ColumnId>[];
  toolbar: Toggleable<ToolbarItemId>[];
  ai: {
    provider: AiProvider;
    /** Model per provider, so switching providers keeps each choice. */
    models: Partial<Record<AiProvider, string>>;
    baseUrl: string;
    /** How "Resolve with AI" settles merge conflicts. */
    conflicts: {
      strategy: ConflictStrategy;
      /** Extra rules in the user's own words, e.g. "package.json: keep the higher version". */
      instructions: string;
    };
  };
}

export type ConflictStrategy = "combine" | "current" | "incoming" | "careful";

/** The criteria "Resolve with AI" can follow: shown in Settings and in the "?" help. */
export const CONFLICT_STRATEGIES: Record<ConflictStrategy, { label: string; short: string; description: string; prompt: string }> = {
  combine: {
    label: "Combine both",
    short: "keeps what both sides meant",
    description:
      "Keeps the intent of both sides. When the changes are compatible it merges them into one version; when they truly contradict each other, it leaves that conflict for you.",
    prompt:
      "Preserve the intent of BOTH sides. If the changes are compatible (different additions, a rename on one side and an edit on the other, etc.), write a merged version that includes both. If they genuinely contradict each other and you can't tell which is right, answer unsure.",
  },
  current: {
    label: "Prefer current",
    short: "your branch wins real clashes",
    description:
      "Merges compatible changes, but when both sides change the same thing in different ways, keeps the current branch's version (the one you're merging into).",
    prompt:
      "Merge compatible changes from both sides. When the two sides make contradicting changes to the same thing, keep the CURRENT side's version.",
  },
  incoming: {
    label: "Prefer incoming",
    short: "the incoming branch wins real clashes",
    description:
      "Merges compatible changes, but when both sides change the same thing in different ways, keeps the incoming branch's version (the one being merged in).",
    prompt:
      "Merge compatible changes from both sides. When the two sides make contradicting changes to the same thing, keep the INCOMING side's version.",
  },
  careful: {
    label: "Only obvious ones",
    short: "touches only the safe, obvious conflicts",
    description:
      "Resolves only conflicts with a clear answer (one side already contains the other, independent additions, whitespace or formatting). Anything that needs judgement is left for you.",
    prompt:
      "Be conservative. Resolve a conflict only when the answer is obvious: one side already contains the other, both sides add independent lines, or the difference is only whitespace/formatting/ordering. For anything that needs a judgement call, answer unsure.",
  },
};

export interface PanelSizes {
  sidebar: number;
  changesList: number;
  changesSplit: number;
  filesTree: number;
  commitInfo: number;
  assistant: number;
  historySplit: number;
  historySplitSide: number;
}

export const DEFAULT_SIZES: PanelSizes = {
  sidebar: 248,
  changesList: 380,
  changesSplit: 0.55,
  filesTree: 300,
  commitInfo: 340,
  assistant: 384,
  historySplit: 0.5,
  historySplitSide: 0.58,
};

/** Provider catalogue shown in Settings → AI. */
export const AI_PROVIDERS: Record<
  Exclude<AiProvider, "none">,
  {
    label: string;
    note: string;
    kind: "api" | "cli" | "local";
    defaultModel: string;
    suggestions: string[];
  }
> = {
  anthropic: {
    label: "Claude API",
    note: "Anthropic API key, billed per use",
    kind: "api",
    defaultModel: "claude-opus-5-5",
    suggestions: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  },
  "claude-code": {
    label: "Claude Code",
    note: "Uses your Claude Pro / Max plan",
    kind: "cli",
    defaultModel: "",
    suggestions: ["opus", "sonnet", "haiku"],
  },
  openai: {
    label: "OpenAI API",
    note: "OpenAI API key, billed per use",
    kind: "api",
    defaultModel: "",
    suggestions: [],
  },
  codex: {
    label: "Codex CLI",
    note: "Uses your ChatGPT plan",
    kind: "cli",
    defaultModel: "",
    suggestions: [],
  },
  compatible: {
    label: "Local / compatible",
    note: "Ollama, LM Studio, OpenRouter, ...",
    kind: "local",
    defaultModel: "",
    suggestions: [],
  },
};

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
  bricolage: {
    label: "Bricolage Grotesque",
    family: '"Bricolage Grotesque Variable"',
    note: "Characterful, compact",
  },
  onest: {
    label: "Onest",
    family: '"Onest Variable"',
    note: "Clean and modern",
  },
  manrope: {
    label: "Manrope",
    family: '"Manrope Variable"',
    note: "Soft geometric",
  },
  space: {
    label: "Space Grotesk",
    family: '"Space Grotesk Variable"',
    note: "Techy, quirky",
  },
  sora: { label: "Sora", family: '"Sora Variable"', note: "Wide, futuristic" },
} as const;

export const TITLE_FONTS = {
  redhat: {
    label: "Red Hat Display",
    family: '"Red Hat Display Variable"',
    note: "Sharp, confident",
    weight: "800",
    variation: "normal",
    tracking: "-0.03em",
  },
  syne: {
    label: "Syne",
    family: '"Syne Variable"',
    note: "Bold, artsy geometric",
    weight: "760",
    variation: "normal",
    tracking: "-0.02em",
  },
  outfit: {
    label: "Outfit",
    family: '"Outfit Variable"',
    note: "Round, clean geometric",
    weight: "650",
    variation: "normal",
    tracking: "-0.03em",
  },
  jakarta: {
    label: "Plus Jakarta Sans",
    family: '"Plus Jakarta Sans Variable"',
    note: "Modern, refined",
    weight: "750",
    variation: "normal",
    tracking: "-0.035em",
  },
  archivo: {
    label: "Archivo Expanded",
    family: '"Archivo Variable"',
    note: "Wide and strong",
    weight: "750",
    variation: '"wdth" 125',
    tracking: "-0.02em",
  },
  lexend: {
    label: "Lexend",
    family: '"Lexend Variable"',
    note: "Friendly, very readable",
    weight: "600",
    variation: "normal",
    tracking: "-0.035em",
  },
  familjen: {
    label: "Familjen Grotesk",
    family: '"Familjen Grotesk Variable"',
    note: "Editorial grotesk",
    weight: "700",
    variation: "normal",
    tracking: "-0.03em",
  },
  gabarito: {
    label: "Gabarito",
    family: '"Gabarito Variable"',
    note: "Friendly, punchy",
    weight: "800",
    variation: "normal",
    tracking: "-0.035em",
  },
  unbounded: {
    label: "Unbounded",
    family: '"Unbounded Variable"',
    note: "Wide, futuristic",
    weight: "600",
    variation: "normal",
    tracking: "-0.04em",
  },
  space: {
    label: "Space Grotesk",
    family: '"Space Grotesk Variable"',
    note: "Techy, quirky",
    weight: "700",
    variation: "normal",
    tracking: "-0.03em",
  },
  bricolage: {
    label: "Bricolage Grotesque",
    family: '"Bricolage Grotesque Variable"',
    note: "Quirky grotesque",
    weight: "760",
    variation: "normal",
    tracking: "-0.03em",
  },
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
  graph: "",
  description: "Description",
  author: "Author",
  date: "Date",
  hash: "Commit",
};

export const TOOLBAR_LABELS: Record<ToolbarItemId, string> = {
  branch: "Current branch",
  create: "New (branch, tag, file…)",
  search: "Search",
  assistant: "AI assistant",
  fetch: "Fetch",
  pull: "Pull",
  push: "Push",
};

/** Items that must always stay visible. */
export const LOCKED = new Set<string>(["description"]);

const SETTINGS_VERSION = 2;

const DEFAULTS: Settings = {
  version: SETTINGS_VERSION,
  accent: "fuchsia",
  uiFont: "bricolage",
  titleFont: "redhat",
  monoFont: "commit",
  scale: 1,
  density: "comfortable",
  glass: "frosted",
  ambient: true,
  ambientMotion: true,
  sidebarSide: "left",
  sidebarMode: "auto",
  sizes: { ...DEFAULT_SIZES },
  detailsPosition: "bottom",
  relativeDates: true,
  checkUpdates: true,
  diffMode: "unified",
  diffIgnoreWhitespace: false,
  autoFetch: 15,
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
    { id: "create", visible: true },
    { id: "search", visible: true },
    { id: "assistant", visible: true },
    { id: "fetch", visible: true },
    { id: "pull", visible: true },
    { id: "push", visible: true },
  ],
  ai: {
    provider: "none",
    models: {},
    baseUrl: "http://localhost:11434/v1",
    conflicts: { strategy: "combine", instructions: "" },
  },
};

const KEY = "orbe.settings";

/** Merge stored lists with defaults so new items added in updates still appear. */
function mergeList<T extends string>(
  stored: Toggleable<T>[] | undefined,
  defaults: Toggleable<T>[],
) {
  if (!Array.isArray(stored)) return structuredClone(defaults);
  const known = new Set(defaults.map((d) => d.id));
  const kept = stored.filter((s) => known.has(s.id));
  const missing = defaults.filter((d) => !kept.some((k) => k.id === d.id));
  return [...kept, ...structuredClone(missing)];
}

function load(): Settings {
  try {
    const raw = JSON.parse(
      localStorage.getItem(KEY) ?? "{}",
    ) as Partial<Settings>;
    const merged = { ...structuredClone(DEFAULTS), ...raw };
    if (!(merged.accent in ACCENTS)) merged.accent = DEFAULTS.accent;
    if (!(merged.uiFont in UI_FONTS)) merged.uiFont = DEFAULTS.uiFont;
    if (!(merged.titleFont in TITLE_FONTS))
      merged.titleFont = DEFAULTS.titleFont;
    // v2: the title font moved to Red Hat Display (Fraunces/Syne were earlier defaults).
    if ((raw.version ?? 1) < 2) merged.titleFont = DEFAULTS.titleFont;
    merged.version = SETTINGS_VERSION;
    if (!(merged.monoFont in MONO_FONTS)) merged.monoFont = DEFAULTS.monoFont;
    if (!["auto", "open", "icons"].includes(merged.sidebarMode))
      merged.sidebarMode = "auto";
    merged.sizes = { ...DEFAULT_SIZES };
    for (const [k, v] of Object.entries(raw.sizes ?? {})) {
      if (k in DEFAULT_SIZES && typeof v === "number" && Number.isFinite(v))
        merged.sizes[k as keyof PanelSizes] = v;
    }
    merged.scale = Math.min(1.25, Math.max(0.85, Number(merged.scale) || 1));
    merged.sidebarSections = mergeList(
      raw.sidebarSections,
      DEFAULTS.sidebarSections,
    );
    merged.columns = mergeList(raw.columns, DEFAULTS.columns);
    merged.toolbar = mergeList(raw.toolbar, DEFAULTS.toolbar);
    merged.ai = { ...structuredClone(DEFAULTS.ai), ...(raw.ai ?? {}) };
    merged.ai.conflicts = { ...structuredClone(DEFAULTS.ai.conflicts), ...(raw.ai?.conflicts ?? {}) };
    if (!(merged.ai.conflicts.strategy in CONFLICT_STRATEGIES)) merged.ai.conflicts.strategy = DEFAULTS.ai.conflicts.strategy;
    if (merged.ai.provider !== "none" && !(merged.ai.provider in AI_PROVIDERS))
      merged.ai.provider = "none";
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

  /** Provider settings for the backend; the model falls back to the provider default. */
  aiConfig = $derived.by<AiConfig>(() => {
    const { provider, models, baseUrl } = this.value.ai;
    const model =
      models[provider]?.trim() ||
      (provider !== "none" ? AI_PROVIDERS[provider].defaultModel : "");
    return { provider, model, baseUrl };
  });

  reset() {
    // Keep the AI provider choice: it isn't a visual preference.
    const ai = this.value.ai;
    this.value = { ...structuredClone(DEFAULTS), ai };
  }

  /** Persist + apply; call once from the root component inside an $effect. */
  apply() {
    const s = this.value;
    localStorage.setItem(KEY, JSON.stringify(s));
    const root = document.documentElement;
    root.style.setProperty("--accent-h", String(ACCENTS[s.accent].hue));
    root.style.setProperty(
      "--font-sans",
      `${UI_FONTS[s.uiFont].family}, ui-sans-serif, system-ui, sans-serif`,
    );
    const title = TITLE_FONTS[s.titleFont];
    root.style.setProperty(
      "--font-display",
      `${title.family}, ui-sans-serif, system-ui, sans-serif`,
    );
    root.style.setProperty("--display-weight", title.weight);
    root.style.setProperty("--display-variation", title.variation);
    root.style.setProperty("--display-tracking", title.tracking);
    root.style.setProperty(
      "--font-mono",
      `${MONO_FONTS[s.monoFont].family}, ui-monospace, Consolas, monospace`,
    );
    applyScale(s.scale);
    root.dataset.glass = s.glass;
    root.dataset.density = s.density;
  }
}

export const settings = new SettingsStore();

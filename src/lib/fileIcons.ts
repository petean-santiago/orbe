/**
 * File and folder icons, VS Code style: special folders get their own colour
 * and emblem, files are coloured by language. Colours are OKLCH hues so they
 * sit well on the dark glass; `null` hue means a neutral grey.
 */
import {
  AppWindow,
  BookOpen,
  Box,
  Braces,
  Code,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileBadge,
  FileBox,
  FileBraces,
  FileCode,
  FileCog,
  FileDatabase,
  FileImage,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  FlaskConical,
  GitBranch,
  Image,
  Languages,
  LayoutGrid,
  Palette,
  Server,
  Settings,
  Terminal,
  Wrench,
} from "@lucide/svelte";
import type { Icon } from "./ui.svelte";

export interface FolderStyle {
  hue: number | null;
  emblem: Icon | null;
}

export interface FileStyle {
  icon: Icon;
  hue: number | null;
}

const FOLDERS: [string[], FolderStyle][] = [
  [["src", "source", "lib", "app", "packages", "pkg", "internal", "core", "crates"], { hue: 245, emblem: Code }],
  [["components", "ui", "widgets", "views", "pages", "routes", "screens", "layouts"], { hue: 295, emblem: LayoutGrid }],
  [["assets", "images", "img", "icons", "media", "static", "public", "fonts", "resources", "res"], { hue: 75, emblem: Image }],
  [["docs", "doc", "documentation", "wiki", "guides"], { hue: 220, emblem: BookOpen }],
  [["test", "tests", "__tests__", "spec", "specs", "e2e", "cypress", "playwright", "__mocks__", "fixtures"], { hue: 150, emblem: FlaskConical }],
  [[".github", ".gitlab", ".git", ".husky", ".circleci", ".gitea"], { hue: 30, emblem: GitBranch }],
  [[".vscode", ".idea", "config", "configs", "settings", ".config", ".cargo"], { hue: 260, emblem: Settings }],
  [["scripts", "bin", "tools", "cli", "tasks"], { hue: 125, emblem: Terminal }],
  [["node_modules", "vendor", "target", "dist", "build", "out", ".next", ".svelte-kit", ".nuxt", "coverage", ".turbo", ".cache"], { hue: null, emblem: Box }],
  [["styles", "css", "scss", "sass", "theme", "themes"], { hue: 340, emblem: Palette }],
  [["api", "server", "backend", "services", "handlers", "controllers", "functions"], { hue: 180, emblem: Server }],
  [["db", "database", "migrations", "prisma", "sql", "models", "schema", "schemas"], { hue: 50, emblem: Database }],
  [["i18n", "locales", "locale", "lang", "langs", "translations"], { hue: 200, emblem: Languages }],
  [["hooks", "utils", "util", "helpers", "shared", "common", "stores", "store", "actions"], { hue: 270, emblem: Wrench }],
  [["src-tauri", "tauri", "electron", "desktop", "ios", "android", "mobile", "icons-gen"], { hue: 40, emblem: AppWindow }],
  [["types", "typings", "@types", "interfaces"], { hue: 230, emblem: Braces }],
];

const FOLDER_BY_NAME = new Map<string, FolderStyle>();
for (const [names, style] of FOLDERS) for (const n of names) FOLDER_BY_NAME.set(n, style);

const DEFAULT_FOLDER: FolderStyle = { hue: -1, emblem: null };

/** Style for a folder by its name. Hue -1 means "use the accent colour". */
export function folderStyle(name: string): FolderStyle {
  return FOLDER_BY_NAME.get(name.toLowerCase()) ?? DEFAULT_FOLDER;
}

const code = (hue: number | null): FileStyle => ({ icon: FileCode, hue });

const EXT: Record<string, FileStyle> = {
  ts: code(245), tsx: code(245), mts: code(245), cts: code(245),
  js: code(95), jsx: code(95), mjs: code(95), cjs: code(95),
  svelte: code(35), vue: code(155), astro: code(25),
  rs: code(40), go: code(200), py: code(225), rb: code(20), php: code(275),
  java: code(30), kt: code(290), kts: code(290), scala: code(15), groovy: code(200),
  c: code(250), h: code(250), cpp: code(250), hpp: code(250), cc: code(250),
  cs: code(300), fs: code(220), swift: code(30), dart: code(205), lua: code(255),
  zig: code(75), ex: code(295), exs: code(295), erl: code(0), hs: code(285), ml: code(45),
  r: code(240), jl: code(300), nim: code(85), sol: code(250), wasm: code(270),
  html: code(30), htm: code(30), xml: code(45), css: code(240), scss: code(340), sass: code(340), less: code(260),
  graphql: code(340), gql: code(340), prisma: code(220), proto: code(190),
  sh: { icon: FileTerminal, hue: 140 }, bash: { icon: FileTerminal, hue: 140 }, zsh: { icon: FileTerminal, hue: 140 },
  ps1: { icon: FileTerminal, hue: 230 }, bat: { icon: FileTerminal, hue: 60 }, cmd: { icon: FileTerminal, hue: 60 },
  json: { icon: FileBraces, hue: 85 }, jsonc: { icon: FileBraces, hue: 85 }, json5: { icon: FileBraces, hue: 85 },
  yaml: { icon: FileCog, hue: 10 }, yml: { icon: FileCog, hue: 10 }, toml: { icon: FileCog, hue: 40 },
  ini: { icon: FileCog, hue: null }, conf: { icon: FileCog, hue: null }, cfg: { icon: FileCog, hue: null },
  md: { icon: FileText, hue: 220 }, mdx: { icon: FileText, hue: 220 }, rst: { icon: FileText, hue: 220 },
  txt: { icon: FileText, hue: null }, pdf: { icon: FileText, hue: 15 },
  png: { icon: FileImage, hue: 300 }, jpg: { icon: FileImage, hue: 300 }, jpeg: { icon: FileImage, hue: 300 },
  gif: { icon: FileImage, hue: 300 }, webp: { icon: FileImage, hue: 300 }, ico: { icon: FileImage, hue: 300 },
  icns: { icon: FileImage, hue: 300 }, bmp: { icon: FileImage, hue: 300 }, avif: { icon: FileImage, hue: 300 },
  svg: { icon: FileImage, hue: 55 },
  woff: { icon: FileType, hue: 330 }, woff2: { icon: FileType, hue: 330 }, ttf: { icon: FileType, hue: 330 }, otf: { icon: FileType, hue: 330 },
  zip: { icon: FileArchive, hue: 45 }, tar: { icon: FileArchive, hue: 45 }, gz: { icon: FileArchive, hue: 45 }, "7z": { icon: FileArchive, hue: 45 }, rar: { icon: FileArchive, hue: 45 },
  mp3: { icon: FileAudio, hue: 320 }, wav: { icon: FileAudio, hue: 320 }, ogg: { icon: FileAudio, hue: 320 }, flac: { icon: FileAudio, hue: 320 },
  mp4: { icon: FileVideo, hue: 330 }, mov: { icon: FileVideo, hue: 330 }, webm: { icon: FileVideo, hue: 330 },
  csv: { icon: FileSpreadsheet, hue: 145 }, tsv: { icon: FileSpreadsheet, hue: 145 }, xlsx: { icon: FileSpreadsheet, hue: 145 },
  sql: { icon: FileDatabase, hue: 50 }, db: { icon: FileDatabase, hue: 50 }, sqlite: { icon: FileDatabase, hue: 50 },
  lock: { icon: FileLock, hue: null },
  pem: { icon: FileKey, hue: 60 }, key: { icon: FileKey, hue: 60 }, crt: { icon: FileKey, hue: 60 },
};

const NAMES: Record<string, FileStyle> = {
  "package.json": { icon: FileBraces, hue: 140 },
  "package-lock.json": { icon: FileLock, hue: null },
  "pnpm-lock.yaml": { icon: FileLock, hue: null },
  "yarn.lock": { icon: FileLock, hue: null },
  "cargo.lock": { icon: FileLock, hue: null },
  "cargo.toml": { icon: FileCog, hue: 40 },
  "tsconfig.json": { icon: FileCog, hue: 245 },
  "dockerfile": { icon: FileBox, hue: 215 },
  "docker-compose.yml": { icon: FileBox, hue: 215 },
  "makefile": { icon: FileTerminal, hue: 60 },
  "license": { icon: FileBadge, hue: 75 },
  "license.md": { icon: FileBadge, hue: 75 },
  "licence": { icon: FileBadge, hue: 75 },
  ".gitignore": { icon: FileCog, hue: 30 },
  ".gitattributes": { icon: FileCog, hue: 30 },
  ".gitmodules": { icon: FileCog, hue: 30 },
  ".editorconfig": { icon: FileCog, hue: null },
  ".prettierrc": { icon: FileCog, hue: 300 },
  ".npmrc": { icon: FileCog, hue: 15 },
  "readme.md": { icon: FileText, hue: -1 },
};

const DEFAULT_FILE: FileStyle = { icon: File, hue: null };

export function fileStyle(path: string): FileStyle {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name in NAMES) return NAMES[name];
  if (name.startsWith(".env")) return { icon: FileKey, hue: 60 };
  if (/^(vite|vitest|svelte|tailwind|eslint|postcss|webpack|rollup|next|nuxt|astro|playwright|jest)\.config\./.test(name)) {
    return { icon: FileCog, hue: 270 };
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return DEFAULT_FILE;
  return EXT[name.slice(dot + 1)] ?? DEFAULT_FILE;
}

/** CSS colour for a hue: -1 = accent, null = neutral grey. */
export function hueColor(hue: number | null, lightness = 0.78, chroma = 0.13): string {
  if (hue === null) return `oklch(${lightness - 0.08} 0.02 300)`;
  if (hue === -1) return `oklch(${lightness} ${chroma} var(--accent-h))`;
  return `oklch(${lightness} ${chroma} ${hue})`;
}

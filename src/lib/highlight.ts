/**
 * Syntax highlighting with Shiki (the TextMate grammars VS Code uses).
 *
 * Grammars are loaded on demand, one per language actually opened, and the
 * colours come from CSS variables (`--code-*` in app.css) so they match
 * Orbe's palette and follow the accent colour.
 */
import { createHighlighterCore, type HighlighterCore, type ThemeRegistration, type ThemedToken } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { bundledLanguages, bundledLanguagesAlias } from "shiki/langs";

export type { ThemedToken };

/** Beyond this, highlighting would cost more than it helps; show plain text. */
const MAX_CHARS = 250_000;
const MAX_LINES = 8_000;

const v = (name: string) => `var(--code-${name})`;

const THEME: ThemeRegistration = {
  name: "orbe",
  type: "dark",
  colors: { "editor.foreground": v("fg"), "editor.background": "transparent" },
  fg: v("fg"),
  bg: "transparent",
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment", "string.comment"], settings: { foreground: v("comment"), fontStyle: "italic" } },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new", "keyword.operator.expression", "keyword.operator.logical.python", "variable.language", "support.type.primitive"],
      settings: { foreground: v("keyword") },
    },
    { scope: ["string", "string.quoted", "string.template", "markup.inline.raw", "markup.raw", "constant.other.symbol"], settings: { foreground: v("string") } },
    { scope: ["string.regexp", "constant.character.escape", "constant.other.character-class.regexp"], settings: { foreground: v("regex") } },
    {
      scope: ["constant.numeric", "constant.language", "constant.character", "support.constant", "constant.other.color", "variable.other.constant", "variable.other.enummember"],
      settings: { foreground: v("number") },
    },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call.generic", "variable.function", "entity.name.method", "support.function.builtin"],
      settings: { foreground: v("function") },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "entity.name.namespace", "entity.name.module", "support.type", "support.class", "entity.other.inherited-class", "storage.type.rust", "entity.name.type.rust", "storage.type.java", "entity.name.lifetime"],
      settings: { foreground: v("type") },
    },
    { scope: ["variable.parameter", "meta.parameter", "entity.name.variable.parameter"], settings: { foreground: v("parameter") } },
    {
      scope: ["support.type.property-name", "meta.object-literal.key", "variable.other.property", "variable.other.object.property", "entity.name.tag.yaml", "support.type.property-name.json", "support.type.property-name.toml", "entity.name.tag.toml", "keyword.other.definition.ini", "support.type.property-name.css", "meta.property-name"],
      settings: { foreground: v("property") },
    },
    { scope: ["entity.name.tag", "meta.tag.sgml", "punctuation.definition.tag", "entity.name.tag.css", "entity.other.attribute-name.class.css", "entity.other.attribute-name.id.css"], settings: { foreground: v("tag") } },
    { scope: ["entity.other.attribute-name", "entity.other.attribute-name.html", "meta.attribute", "meta.decorator", "entity.name.function.decorator", "punctuation.decorator", "meta.annotation", "storage.type.annotation"], settings: { foreground: v("attribute") } },
    { scope: ["punctuation", "meta.brace", "keyword.operator", "punctuation.separator", "punctuation.terminator", "meta.delimiter"], settings: { foreground: v("punctuation") } },
    { scope: ["markup.heading", "entity.name.section", "markup.heading entity.name"], settings: { foreground: v("heading"), fontStyle: "bold" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.underline.link", "string.other.link", "markup.link"], settings: { foreground: v("link") } },
    { scope: ["markup.list punctuation.definition.list.begin", "beginning.punctuation.definition.list"], settings: { foreground: v("keyword") } },
    { scope: ["markup.quote"], settings: { foreground: v("comment"), fontStyle: "italic" } },
    { scope: ["markup.inserted"], settings: { foreground: "var(--color-added)" } },
    { scope: ["markup.deleted", "invalid"], settings: { foreground: "var(--color-deleted)" } },
  ],
};

let highlighter: Promise<HighlighterCore> | null = null;

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [THEME],
    langs: [],
    engine: createOnigurumaEngine(import("shiki/wasm")),
  });
  return highlighter;
}

/** File names that say more than their extension. */
const BY_NAME: Record<string, string> = {
  dockerfile: "docker",
  makefile: "make",
  "cmakelists.txt": "cmake",
  ".env": "dotenv",
  "cargo.lock": "toml",
  gemfile: "ruby",
  rakefile: "ruby",
  jenkinsfile: "groovy",
  ".bashrc": "bash",
  ".zshrc": "zsh",
  ".editorconfig": "ini",
};

const BY_EXT: Record<string, string> = {
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  h: "c",
  hpp: "cpp",
  hh: "cpp",
  cc: "cpp",
  cs: "csharp",
  kt: "kotlin",
  kts: "kotlin",
  rb: "ruby",
  py: "python",
  rs: "rust",
  sh: "bash",
  zsh: "bash",
  ps1: "powershell",
  psm1: "powershell",
  bat: "bat",
  cmd: "bat",
  yml: "yaml",
  md: "markdown",
  mdx: "mdx",
  htm: "html",
  svg: "xml",
  plist: "xml",
  conf: "ini",
  cfg: "ini",
  gradle: "groovy",
  tf: "hcl",
  jsonc: "jsonc",
  json5: "json5",
  txt: "",
};

const known = new Set<string>([...Object.keys(bundledLanguages), ...Object.keys(bundledLanguagesAlias)]);

/** Shiki language id for a path, or null for plain text. */
export function languageFor(path: string): string | null {
  const name = path.split("/").pop()!.toLowerCase();
  if (name in BY_NAME) return BY_NAME[name];
  if (name.startsWith(".env")) return "dotenv";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1);
  const lang = ext in BY_EXT ? BY_EXT[ext] : ext;
  return lang && known.has(lang) ? lang : null;
}

/**
 * Tokenize `code` for `path`. Resolves to one token array per line, or null
 * when the language is unknown or the text too large to be worth it.
 */
export async function tokenize(code: string, path: string): Promise<ThemedToken[][] | null> {
  const lang = languageFor(path);
  if (!lang || code.length > MAX_CHARS) return null;
  let lines = 1;
  for (let i = 0; i < code.length && lines <= MAX_LINES; i++) if (code.charCodeAt(i) === 10) lines++;
  if (lines > MAX_LINES) return null;

  try {
    const hl = await getHighlighter();
    if (!hl.getLoadedLanguages().includes(lang)) {
      // Aliases (e.g. "yml") map to the same grammar loaders as their language.
      const loader =
        (bundledLanguages as Record<string, unknown>)[lang] ?? (bundledLanguagesAlias as Record<string, unknown>)[lang];
      if (!loader) return null;
      await hl.loadLanguage(loader as Parameters<HighlighterCore["loadLanguage"]>[0]);
    }
    return hl.codeToTokensBase(code, { lang, theme: "orbe" });
  } catch (e) {
    console.warn("Highlighting failed for", path, e);
    return null;
  }
}

/** Shiki marks styles with bit flags. */
export const isItalic = (t: ThemedToken) => !!t.fontStyle && (t.fontStyle & 1) !== 0;
export const isBold = (t: ThemedToken) => !!t.fontStyle && (t.fontStyle & 2) !== 0;

/**
 * "Resolve with AI": asks the configured provider to settle a file's merge
 * conflicts, following the criterion chosen in Settings → AI.
 *
 * The model gets each conflict (current side, incoming side, the common
 * ancestor when git kept it) plus the surrounding code, and answers per
 * conflict with a decision and a one-line reason:
 *
 *   ### CONFLICT 2
 *   decision: merged
 *   reason: Keeps the new union type and adds the blur option from incoming.
 *   <<<RESOLUTION
 *   …the lines that replace the conflict…
 *   RESOLUTION>>>
 *
 * "current" / "incoming" / "both" map onto the exact original lines, so they
 * can't be mangled; only "merged" uses text the model wrote. "unsure" leaves
 * the conflict for the user. Nothing is written to disk here.
 */
import { ai } from "./api";
import { settings, CONFLICT_STRATEGIES } from "./settings.svelte";
import type { Choice, ConflictBlock, ParsedConflicts } from "./conflicts";

export type AiDecision = "current" | "incoming" | "both" | "merged" | "unsure";

export interface AiConflictAnswer {
  decision: AiDecision;
  reason: string;
  /** For "merged": the replacement lines. */
  lines: string[] | null;
}

/** Above this the file is sent as excerpts around each conflict. */
const FULL_FILE_CHARS = 40_000;
/** Lines of context kept on each side of a conflict when sending excerpts. */
const EXCERPT_LINES = 25;
/** Hard cap on what we send at all. */
const MAX_PROMPT_CHARS = 160_000;

const SYSTEM = `You resolve Git merge conflicts inside Orbe, a desktop Git client. The developer reviews every answer before anything is saved, so be accurate and honest about uncertainty.

You receive one file. Each conflict is numbered and shows the CURRENT side (the branch being merged into), the INCOMING side (the branch being merged in) and, when available, the BASE (the common ancestor, i.e. what the code looked like before either side changed it). Use the BASE to understand what each side actually changed. Use the surrounding code to keep the result valid: matching brackets, no duplicated declarations, consistent names and types, valid JSON/YAML/CSS.

For EVERY conflict, reply with exactly this block and nothing else:

### CONFLICT <number>
decision: current | incoming | both | merged | unsure
reason: <one short sentence, in plain language, saying why>
<<<RESOLUTION
<only for "merged": the exact lines that replace the whole conflict, with the file's indentation>
RESOLUTION>>>

Decisions:
- current: keep the current side exactly as it is.
- incoming: keep the incoming side exactly as it is.
- both: keep both sides, current first, exactly as they are (only when that is valid code as-is).
- merged: you wrote a combined version. Put it between <<<RESOLUTION and RESOLUTION>>>. Never include conflict markers.
- unsure: you can't decide safely; the developer will. Omit the RESOLUTION part.

Omit the RESOLUTION part for every decision except merged. Do not run commands or read other files. Do not add any text before the first ### or after the last block.`;

function sideText(lines: string[], [from, to]: [number, number]): string {
  return to > from ? lines.slice(from, to).join("\n") : "(empty: these lines were removed on this side)";
}

/** The file, with each conflict replaced by a numbered placeholder; long unchanged stretches trimmed when the file is big. */
function fileContext(parsed: ParsedConflicts): string {
  const { lines, blocks } = parsed;
  const big = lines.join("\n").length > FULL_FILE_CHARS;
  const out: string[] = [];
  blocks.forEach((b, i) => {
    if (b.kind === "conflict") {
      out.push(`[[CONFLICT ${b.index + 1}]]`);
      return;
    }
    const [from, to] = b.range;
    const first = i === 0;
    const last = i === blocks.length - 1;
    if (!big || to - from <= EXCERPT_LINES * 2 + 5) {
      out.push(...lines.slice(from, to));
      return;
    }
    const headEnd = first ? from : from + EXCERPT_LINES;
    const tailStart = last ? to : to - EXCERPT_LINES;
    out.push(...lines.slice(from, headEnd));
    out.push(`[… ${tailStart - headEnd} unchanged lines not shown …]`);
    out.push(...lines.slice(tailStart, to));
  });
  return out.join("\n");
}

function conflictText(parsed: ParsedConflicts, c: ConflictBlock): string {
  const parts = [
    `### CONFLICT ${c.index + 1}`,
    `--- CURRENT${c.oursLabel ? ` (${c.oursLabel})` : ""} ---`,
    sideText(parsed.lines, c.ours),
  ];
  if (c.base) parts.push("--- BASE (common ancestor) ---", sideText(parsed.lines, c.base));
  parts.push(`--- INCOMING${c.theirsLabel ? ` (${c.theirsLabel})` : ""} ---`, sideText(parsed.lines, c.theirs));
  return parts.join("\n");
}

/** The criterion and the user's own rules, as sent to the model. */
export function criterionPrompt(): string {
  const conf = settings.value.ai.conflicts;
  const rules = conf.instructions.trim();
  return `Criterion: ${CONFLICT_STRATEGIES[conf.strategy].prompt}${rules ? `\n\nThe developer's own rules (follow them, they take priority):\n${rules}` : ""}`;
}

export function buildPrompt(opts: {
  path: string;
  parsed: ParsedConflicts;
  /** Only these conflicts are asked about (the ones the user hasn't settled). */
  targets: ConflictBlock[];
  oursName: string;
  theirsName: string;
  rebasing: boolean;
}): string {
  const { path, parsed, targets, oursName, theirsName, rebasing } = opts;
  const who = rebasing
    ? `This is a rebase: CURRENT is ${oursName} (the branch being rebased onto) and INCOMING is ${theirsName} (the developer's own commit being replayed).`
    : `CURRENT is ${oursName}; INCOMING is ${theirsName}.`;
  let prompt = [
    `File: ${path}`,
    who,
    criterionPrompt(),
    `Resolve these conflicts: ${targets.map((c) => c.index + 1).join(", ")}.`,
    "",
    "The file, with each conflict shown as [[CONFLICT n]]:",
    "```",
    fileContext(parsed),
    "```",
    "",
    "The conflicts:",
    "",
    targets.map((c) => conflictText(parsed, c)).join("\n\n"),
  ].join("\n");
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error("This file's conflicts are too large to send to the AI. Resolve them by hand, or in smaller pieces with Edit.");
  }
  return prompt;
}

const DECISIONS = new Set<AiDecision>(["current", "incoming", "both", "merged", "unsure"]);

/** Read the model's reply into one answer per conflict number (1-based). */
export function parseAnswers(raw: string): Map<number, AiConflictAnswer> {
  const answers = new Map<number, AiConflictAnswer>();
  const text = raw.replace(/\r\n/g, "\n");
  const heads = [...text.matchAll(/^#{2,4}\s*CONFLICT\s+(\d+)\s*$/gim)];
  heads.forEach((h, k) => {
    const n = Number(h[1]);
    const body = text.slice(h.index! + h[0].length, k + 1 < heads.length ? heads[k + 1].index : text.length);
    const decisionRaw = /^\s*\**decision\**\s*:\s*\**\s*([a-z]+)/im.exec(body)?.[1]?.toLowerCase() ?? "unsure";
    const decision: AiDecision = DECISIONS.has(decisionRaw as AiDecision) ? (decisionRaw as AiDecision) : "unsure";
    const reason = (/^\s*\**reason\**\s*:\s*(.+)$/im.exec(body)?.[1] ?? "").replace(/\*+/g, "").trim();
    let lines: string[] | null = null;
    const res = /<<<RESOLUTION[^\n]*\n([\s\S]*?)\n?RESOLUTION>>>/.exec(body);
    if (res) {
      let inner = res[1];
      // A model that fenced the code inside the block.
      const fenced = /^`{3,}[^\n]*\n([\s\S]*?)\n`{3,}\s*$/.exec(inner);
      if (fenced) inner = fenced[1];
      lines = inner.split("\n");
    }
    answers.set(n, { decision, reason, lines });
  });
  return answers;
}

/** True when text still has a conflict marker line. */
const MARKER = /^(<{7}|={7}|>{7}|\|{7})(\s|$)/m;

export interface AiOutcome {
  choice: Choice | null;
  custom: string[] | null;
  answer: AiConflictAnswer;
  /** The user changed this block by hand after the AI answered. */
  byHand?: boolean;
}

/** Turn an answer into a choice for the block, refusing anything that looks broken. */
export function toOutcome(answer: AiConflictAnswer): AiOutcome {
  switch (answer.decision) {
    case "current":
      return { choice: "ours", custom: null, answer };
    case "incoming":
      return { choice: "theirs", custom: null, answer };
    case "both":
      return { choice: "both", custom: null, answer };
    case "merged":
      if (!answer.lines || MARKER.test(answer.lines.join("\n"))) {
        return { choice: null, custom: null, answer: { ...answer, decision: "unsure", reason: answer.reason || "The suggested merge wasn't usable." } };
      }
      return { choice: "custom", custom: answer.lines, answer };
    default:
      return { choice: null, custom: null, answer: { ...answer, decision: "unsure" } };
  }
}

/** Ask the provider. Resolves to one outcome per target conflict (missing answers count as unsure). */
export async function resolveWithAi(opts: Parameters<typeof buildPrompt>[0] & { cwd: string | null }): Promise<Map<number, AiOutcome>> {
  const prompt = buildPrompt(opts);
  const raw = await ai.complete(settings.aiConfig, SYSTEM, [{ role: "user", content: prompt }], "medium", opts.cwd);
  const answers = parseAnswers(raw);
  if (!answers.size) throw new Error("The AI didn't answer in the expected format. Try again, or pick another model in Settings → AI.");
  const out = new Map<number, AiOutcome>();
  for (const c of opts.targets) {
    const a = answers.get(c.index + 1) ?? { decision: "unsure" as const, reason: "The AI didn't answer for this conflict.", lines: null };
    out.set(c.index, toOutcome(a));
  }
  return out;
}

/** Label for an applied decision, shown on the block. */
export const DECISION_LABELS: Record<AiDecision, string> = {
  current: "kept current",
  incoming: "kept incoming",
  both: "kept both",
  merged: "merged both sides",
  unsure: "left for you",
};

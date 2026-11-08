/**
 * Parse git conflict markers so conflicts can be resolved block by block.
 *
 *   <<<<<<< HEAD            ← current side (ours)
 *   …
 *   ||||||| base            ← optional, with merge.conflictStyle=diff3/zdiff3
 *   …
 *   =======
 *   …                       ← incoming side (theirs)
 *   >>>>>>> feature/x
 *
 * Blocks keep line indexes into `lines` rather than copies, so the view can
 * reuse one syntax-highlighting pass for the whole file.
 */

/** How a conflict block was resolved. */
export type Choice = "ours" | "theirs" | "both" | "both-reversed";

/** Half-open range of line indexes: [from, to). */
export type Range = [number, number];

export interface TextBlock {
  kind: "text";
  range: Range;
}

export interface ConflictBlock {
  kind: "conflict";
  /** 0-based position among the conflicts of the file. */
  index: number;
  /** The whole block, markers included. */
  range: Range;
  ours: Range;
  base: Range | null;
  theirs: Range;
  oursLabel: string;
  theirsLabel: string;
}

export type Block = TextBlock | ConflictBlock;

export interface ParsedConflicts {
  lines: string[];
  eol: "\n" | "\r\n";
  blocks: Block[];
  conflicts: ConflictBlock[];
}

const START = /^<{7}(?: (.*))?$/;
const BASE = /^\|{7}(?: .*)?$/;
const SPLIT = /^={7}$/;
const END = /^>{7}(?: (.*))?$/;

/** True when the text still contains a conflict start marker. */
export function hasMarkers(text: string): boolean {
  return /^<{7}(?: |$)/m.test(text) && /^>{7}(?: |$)/m.test(text);
}

/**
 * Split a conflicted file into text and conflict blocks. Returns null when
 * the markers are malformed (unclosed or nested), so the caller can fall
 * back to plain editing.
 */
export function parseConflicts(text: string): ParsedConflicts | null {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const blocks: Block[] = [];
  const conflicts: ConflictBlock[] = [];

  let textStart = 0;
  let i = 0;
  while (i < lines.length) {
    const start = START.exec(lines[i]);
    if (!start) {
      i++;
      continue;
    }
    if (i > textStart) blocks.push({ kind: "text", range: [textStart, i] });

    const blockStart = i;
    const oursFrom = i + 1;
    let oursTo = -1;
    let base: Range | null = null;
    let baseFrom = -1;
    let theirsFrom = -1;
    let end: RegExpExecArray | null = null;

    for (i = oursFrom; i < lines.length; i++) {
      const line = lines[i];
      if (START.test(line)) return null; // nested markers: don't guess
      if (theirsFrom < 0 && baseFrom < 0 && oursTo < 0 && BASE.test(line)) {
        oursTo = i;
        baseFrom = i + 1;
      } else if (theirsFrom < 0 && SPLIT.test(line)) {
        if (baseFrom >= 0) base = [baseFrom, i];
        else oursTo = i;
        theirsFrom = i + 1;
      } else if (theirsFrom >= 0 && (end = END.exec(line))) {
        break;
      }
    }
    if (!end || theirsFrom < 0) return null; // unclosed block

    const block: ConflictBlock = {
      kind: "conflict",
      index: conflicts.length,
      range: [blockStart, i + 1],
      ours: [oursFrom, oursTo],
      base,
      theirs: [theirsFrom, i],
      oursLabel: start[1]?.trim() ?? "",
      theirsLabel: end[1]?.trim() ?? "",
    };
    blocks.push(block);
    conflicts.push(block);
    i++;
    textStart = i;
  }
  if (textStart < lines.length) blocks.push({ kind: "text", range: [textStart, lines.length] });

  return { lines, eol, blocks, conflicts };
}

/** Line indexes a choice keeps, in order. */
export function chosenLines(block: ConflictBlock, choice: Choice): number[] {
  const span = ([from, to]: Range) => Array.from({ length: to - from }, (_, k) => from + k);
  switch (choice) {
    case "ours":
      return span(block.ours);
    case "theirs":
      return span(block.theirs);
    case "both":
      return [...span(block.ours), ...span(block.theirs)];
    case "both-reversed":
      return [...span(block.theirs), ...span(block.ours)];
  }
}

/**
 * The file with each conflict replaced by its choice. Unresolved conflicts
 * keep their markers, so nothing is lost if the user saves early.
 */
export function buildResult(parsed: ParsedConflicts, choices: (Choice | null)[]): string {
  const out: string[] = [];
  for (const b of parsed.blocks) {
    if (b.kind === "text") {
      out.push(...parsed.lines.slice(b.range[0], b.range[1]));
      continue;
    }
    const choice = choices[b.index];
    const keep = choice ? chosenLines(b, choice) : Array.from({ length: b.range[1] - b.range[0] }, (_, k) => b.range[0] + k);
    for (const i of keep) out.push(parsed.lines[i]);
  }
  return out.join(parsed.eol);
}

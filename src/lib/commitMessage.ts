/**
 * Turn whatever a model replied into a clean commit message.
 *
 * Models, and CLI agents in particular, like to wrap the message: a preamble
 * ("Here's a commit message:"), a code fence, a ready-to-run
 * `git commit -m "..." -m "..."` command, or quotes. We only want the message.
 */

export interface CommitMessage {
  summary: string;
  description: string;
}

const FENCE = /`{3,}[^\n]*\n([\s\S]*?)`{3,}/;
const PREAMBLE = /^(here('s| is)|sure|certainly|okay|ok)\b[^\n]*:\s*$/i;
const LABEL = /^\**\s*(commit message|message|subject|summary|title)\s*\**\s*:\s*\**\s*/i;

/** Pull the -m / --message arguments out of a `git commit` command, if there is one. */
function fromGitCommand(text: string): string | null {
  // Quoted messages may span lines, so read from the command to the end of its block.
  const at = text.search(/git\s+commit\b/);
  if (at === -1) return null;
  const rest = text.slice(at);
  const end = rest.indexOf("`".repeat(3));
  const cmd = end === -1 ? rest : rest.slice(0, end);
  const parts: string[] = [];
  const re = /(?:-m|--message)(?:\s+|=)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|\$'((?:[^'\\]|\\.)*)')/g;
  for (let m; (m = re.exec(cmd)); ) {
    const value = (m[1] ?? m[2] ?? m[3] ?? "")
      .replace(/\\n/g, "\n")
      .replace(/\\(["'\\$`])/g, "$1");
    parts.push(value.trim());
  }
  return parts.length ? parts.join("\n\n") : null;
}

export function cleanCommitMessage(raw: string): CommitMessage {
  let text = raw.replace(/\r\n/g, "\n").trim();

  // 1. A git command: use its message arguments.
  const fromCmd = fromGitCommand(text);
  if (fromCmd) {
    text = fromCmd;
  } else {
    // 2. A fenced block: the message is inside it.
    const fenced = FENCE.exec(text);
    if (fenced) text = fenced[1];
  }

  // 3. Drop a chatty first line and "Commit message:" labels.
  const lines = text.trim().split("\n");
  while (lines.length > 1 && (PREAMBLE.test(lines[0].trim()) || !lines[0].trim())) lines.shift();
  lines[0] = (lines[0] ?? "").replace(LABEL, "");

  // 4. Tidy the summary line: no heading marks, bold or wrapping quotes.
  const summary = lines[0]
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/^\*\*(.*)\*\*$/, "$1")
    .replace(/^["'`](.*)["'`]$/, "$1")
    .trim();

  const description = lines
    .slice(1)
    .join("\n")
    .replace(/^\s*\n/, "")
    .replace(/\n["'`]$/, "")
    .trim();

  return { summary, description };
}

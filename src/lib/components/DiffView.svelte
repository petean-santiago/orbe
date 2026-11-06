<script lang="ts">
  /**
   * Text diff viewer: unified or split (old | new) layout, syntax highlighting,
   * word-level highlights inside changed lines, and an "ignore whitespace"
   * toggle. The layout and whitespace choices are saved in settings.
   */
  import { Columns2, FileDiff, Pilcrow, Rows2 } from "@lucide/svelte";
  import { isBold, isItalic, tokenize, type ThemedToken } from "../highlight";
  import { settings } from "../settings.svelte";
  import Segmented from "./Segmented.svelte";

  /** `path` picks the syntax-highlighting language. */
  let { diff, path = null, loading = false }: { diff: string | null; path?: string | null; loading?: boolean } = $props();

  type Kind = "add" | "del" | "ctx" | "hunk";
  interface Line {
    kind: Kind;
    text: string;
    oldNo?: number;
    newNo?: number;
    /** Index into the highlighted code lines (not set for hunk headers). */
    code?: number;
  }

  // ---- parsing --------------------------------------------------------------------

  const parsed = $derived.by(() => {
    if (diff === null) return null;
    const lines: Line[] = [];
    let binary = false;
    let started = false;
    let oldNo = 0;
    let newNo = 0;
    let adds = 0;
    let dels = 0;
    let code = 0;

    for (const raw of diff.split("\n")) {
      if (raw.startsWith("@@")) {
        started = true;
        const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/.exec(raw);
        oldNo = m ? parseInt(m[1]) : 0;
        newNo = m ? parseInt(m[2]) : 0;
        lines.push({ kind: "hunk", text: raw });
        continue;
      }
      if (!started) {
        if (raw.startsWith("Binary files")) binary = true;
        continue;
      }
      if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
      if (raw.startsWith("+")) {
        lines.push({ kind: "add", text: raw.slice(1), newNo: newNo++, code: code++ });
        adds++;
      } else if (raw.startsWith("-")) {
        lines.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++, code: code++ });
        dels++;
      } else if (raw.startsWith(" ")) {
        lines.push({ kind: "ctx", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++, code: code++ });
      }
    }
    return { lines, binary, adds, dels };
  });

  // ---- syntax highlighting ------------------------------------------------------------

  // Highlight all diff lines in one pass so multi-line constructs mostly keep their colours.
  let tokens = $state.raw<ThemedToken[][] | null>(null);
  $effect(() => {
    const p = parsed;
    const file = path;
    tokens = null;
    if (!p || !file || p.binary) return;
    let cancelled = false;
    const text = p.lines.filter((l) => l.kind !== "hunk").map((l) => l.text).join("\n");
    tokenize(text, file).then((t) => !cancelled && (tokens = t));
    return () => (cancelled = true);
  });

  // ---- word-level changes ---------------------------------------------------------------

  type Range = [number, number];

  /** Character ranges that differ between two lines, or null if they're too different to be useful. */
  function wordDiff(a: string, b: string): [Range[], Range[]] | null {
    const split = (s: string) => s.match(/\s+|\w+|[^\w\s]/g) ?? [];
    const x = split(a);
    const y = split(b);
    if (!x.length || !y.length || x.length * y.length > 40_000) return null;
    // Longest common subsequence over words.
    const dp = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const keepA = new Array(x.length).fill(false);
    const keepB = new Array(y.length).fill(false);
    for (let i = 0, j = 0; i < x.length && j < y.length; ) {
      if (x[i] === y[j]) (keepA[i++] = true), (keepB[j++] = true);
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    const ranges = (parts: string[], keep: boolean[]) => {
      const out: Range[] = [];
      let at = 0;
      parts.forEach((p, i) => {
        if (!keep[i] && p.trim()) {
          const last = out[out.length - 1];
          if (last && last[1] >= at - 1) last[1] = at + p.length;
          else out.push([at, at + p.length]);
        }
        at += p.length;
      });
      return out;
    };
    const ra = ranges(x, keepA);
    const rb = ranges(y, keepB);
    const changed = (r: Range[], len: number) => r.reduce((s, [p, q]) => s + q - p, 0) / Math.max(1, len);
    // Lines that are mostly different read better without word highlights.
    if (changed(ra, a.length) > 0.6 && changed(rb, b.length) > 0.6) return null;
    return [ra, rb];
  }

  /** Per-line word highlight ranges, pairing removed and added lines within each change block. */
  const intra = $derived.by(() => {
    const map = new Map<number, Range[]>();
    const lines = parsed?.lines ?? [];
    for (let i = 0; i < lines.length; ) {
      if (lines[i].kind !== "del") {
        i++;
        continue;
      }
      const dels: number[] = [];
      const adds: number[] = [];
      while (i < lines.length && lines[i].kind === "del") dels.push(i++);
      while (i < lines.length && lines[i].kind === "add") adds.push(i++);
      for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
        const a = lines[dels[k]];
        const b = lines[adds[k]];
        if (a.text.length > 600 || b.text.length > 600) continue;
        const r = wordDiff(a.text, b.text);
        if (r) {
          map.set(dels[k], r[0]);
          map.set(adds[k], r[1]);
        }
      }
    }
    return map;
  });

  interface Piece {
    text: string;
    color?: string;
    italic?: boolean;
    bold?: boolean;
    hl?: boolean;
  }

  /** A line's syntax tokens, cut where word-level highlights start and end. */
  function pieces(index: number, line: Line): Piece[] {
    const base: Piece[] =
      tokens && line.code !== undefined && tokens[line.code]
        ? tokens[line.code].map((t) => ({ text: t.content, color: t.color, italic: isItalic(t), bold: isBold(t) }))
        : [{ text: line.text }];
    const ranges = intra.get(index);
    if (!ranges?.length) return base;
    const out: Piece[] = [];
    let at = 0;
    for (const p of base) {
      let start = 0;
      const end = p.text.length;
      while (start < end) {
        const pos = at + start;
        const inside = ranges.find(([a, b]) => pos >= a && pos < b);
        const next = inside ? inside[1] : Math.min(...ranges.map(([a]) => a).filter((a) => a > pos), Infinity);
        const len = Math.min(end - start, next - pos);
        out.push({ ...p, text: p.text.slice(start, start + len), hl: !!inside });
        start += len;
      }
      at += end;
    }
    return out;
  }

  // ---- split layout ------------------------------------------------------------------------

  type SplitRow = { hunk: string } | { left: number | null; right: number | null };

  const splitRows = $derived.by<SplitRow[]>(() => {
    const lines = parsed?.lines ?? [];
    const rows: SplitRow[] = [];
    for (let i = 0; i < lines.length; ) {
      const l = lines[i];
      if (l.kind === "hunk") {
        rows.push({ hunk: l.text });
        i++;
      } else if (l.kind === "ctx") {
        rows.push({ left: i, right: i });
        i++;
      } else {
        const dels: number[] = [];
        const adds: number[] = [];
        while (i < lines.length && lines[i].kind === "del") dels.push(i++);
        while (i < lines.length && lines[i].kind === "add") adds.push(i++);
        for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
      }
    }
    return rows;
  });

  const split = $derived(settings.value.diffMode === "split");
</script>

{#snippet code(index: number, line: Line)}
  {#each pieces(index, line) as p}<span
      class={[p.hl && (line.kind === "del" ? "hl-del" : "hl-add"), p.italic && "italic", p.bold && "font-semibold"]}
      style:color={p.color}>{p.text}</span
    >{/each}
{/snippet}

<div class="relative h-full min-h-0 overflow-auto bg-black/25">
  {#if loading && !parsed}
    <div class="space-y-2 p-5">
      {#each Array(10) as _, i}
        <div class="h-3 animate-pulse rounded bg-surface-2" style:width="{40 + ((i * 37) % 55)}%"></div>
      {/each}
    </div>
  {:else if !parsed}
    <div class="flex h-full flex-col items-center justify-center gap-3 text-fg-faint">
      <div class="flex size-12 items-center justify-center glass rounded-2xl text-accent">
        <FileDiff size={20} />
      </div>
      <p class="text-[13px]">Select a file to see its changes</p>
    </div>
  {:else if parsed.binary}
    <div class="flex h-full items-center justify-center text-[13px] text-fg-faint">Binary file, no text preview</div>
  {:else}
    <div class="sticky top-0 z-10 flex items-center gap-3 border-b border-line-soft bg-[oklch(0.08_0.012_320/0.75)] px-4 py-1.5 text-[12px] backdrop-blur-xl">
      <span class="font-semibold text-added">+{parsed.adds}</span>
      <span class="font-semibold text-deleted">−{parsed.dels}</span>
      <span class="flex h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
        {#if parsed.adds + parsed.dels > 0}
          <span class="bg-added" style:width="{(parsed.adds / (parsed.adds + parsed.dels)) * 100}%"></span>
          <span class="flex-1 bg-deleted"></span>
        {/if}
      </span>
      <span class="flex-1"></span>
      <button
        class={[
          "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] transition-colors",
          settings.value.diffIgnoreWhitespace ? "bg-accent-soft text-accent-fg" : "text-fg-faint hover:bg-surface-2 hover:text-fg-muted",
        ]}
        title="Hide changes that are only whitespace or indentation"
        aria-pressed={settings.value.diffIgnoreWhitespace}
        onclick={() => (settings.value.diffIgnoreWhitespace = !settings.value.diffIgnoreWhitespace)}
      >
        <Pilcrow size={13} /> Ignore whitespace
      </button>
      <Segmented
        bind:value={settings.value.diffMode}
        options={[
          { value: "unified", label: "Unified", icon: Rows2 },
          { value: "split", label: "Split", icon: Columns2 },
        ]}
      />
    </div>

    {#if parsed.lines.length === 0}
      <div class="flex h-[70%] items-center justify-center text-[13px] text-fg-faint">
        {settings.value.diffIgnoreWhitespace ? "Only whitespace changed" : "No textual changes"}
      </div>
    {:else if split}
      <table class="selectable split w-full table-fixed border-collapse font-mono text-[12px] leading-[20px] tracking-normal" class:opacity-60={loading}>
        <colgroup><col class="w-[48px]" /><col /><col class="w-[48px]" /><col /></colgroup>
        <tbody>
          {#each splitRows as row}
            {#if "hunk" in row}
              <tr class="bg-accent-soft/60"><td colspan="4" class="truncate px-4 py-1 text-[12px] text-accent-fg/80">{row.hunk}</td></tr>
            {:else}
              {@const l = row.left !== null ? parsed.lines[row.left] : null}
              {@const r = row.right !== null ? parsed.lines[row.right] : null}
              <tr>
                <td class={["num", l?.kind === "del" && "row-del"]}>{l?.oldNo ?? ""}</td>
                <td class={["code", l ? (l.kind === "del" ? "row-del" : "") : "empty"]}>{#if l}{@render code(row.left!, l)}{/if}</td>
                <td class={["num border-l border-line-soft", r?.kind === "add" && "row-add"]}>{r?.newNo ?? ""}</td>
                <td class={["code", r ? (r.kind === "add" ? "row-add" : "") : "empty"]}>{#if r}{@render code(row.right!, r)}{/if}</td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {:else}
      <table class="selectable w-full border-collapse font-mono text-[12px] leading-[20px] tracking-normal" class:opacity-60={loading}>
        <tbody>
          {#each parsed.lines as line, i}
            {#if line.kind === "hunk"}
              <tr class="bg-accent-soft/60">
                <td colspan="3" class="px-4 py-1 text-[12px] text-accent-fg/80">{line.text}</td>
              </tr>
            {:else}
              <tr class="row-{line.kind}">
                <td class="num">{line.oldNo ?? ""}</td>
                <td class="num">{line.newNo ?? ""}</td>
                <td class="code"><span class="sign">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>{@render code(i, line)}</td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</div>

<style>
  .num {
    width: 1%;
    min-width: 44px;
    padding: 0 8px;
    text-align: right;
    color: var(--color-fg-faint);
    opacity: 0.7;
    user-select: none;
    -webkit-user-select: none;
    vertical-align: top;
    white-space: nowrap;
  }
  .code {
    padding: 0 16px 0 4px;
    white-space: pre;
    color: var(--color-fg-muted);
  }
  /* Split view wraps long lines so each side stays within its half. */
  .split .code {
    white-space: pre-wrap;
    word-break: break-all;
    padding-left: 10px;
  }
  .split .num {
    width: 48px;
  }
  .split .empty {
    background: repeating-linear-gradient(-45deg, transparent 0 6px, oklch(1 0 0 / 0.025) 6px 12px);
  }
  .sign {
    display: inline-block;
    width: 16px;
    user-select: none;
    -webkit-user-select: none;
    opacity: 0.7;
  }
  .row-add,
  tr.row-add {
    background: color-mix(in oklch, var(--color-added) 11%, transparent);
  }
  .row-del,
  tr.row-del {
    background: color-mix(in oklch, var(--color-deleted) 11%, transparent);
  }
  tr.row-add .code,
  tr.row-del .code,
  td.row-add.code,
  td.row-del.code {
    color: var(--color-fg);
  }
  tr.row-add .num,
  tr.row-add .sign,
  td.row-add.num {
    color: var(--color-added);
  }
  tr.row-del .num,
  tr.row-del .sign,
  td.row-del.num {
    color: var(--color-deleted);
  }
  /* Word-level highlights inside changed lines */
  .hl-add {
    background: color-mix(in oklch, var(--color-added) 32%, transparent);
    border-radius: 3px;
  }
  .hl-del {
    background: color-mix(in oklch, var(--color-deleted) 34%, transparent);
    border-radius: 3px;
  }
  tr:not(.row-add):not(.row-del):hover {
    background: var(--color-surface-1);
  }
</style>

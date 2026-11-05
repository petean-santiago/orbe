<script lang="ts">
  import { FileDiff } from "@lucide/svelte";

  let { diff, loading = false }: { diff: string | null; loading?: boolean } = $props();

  type Kind = "add" | "del" | "ctx" | "hunk";
  interface Line {
    kind: Kind;
    text: string;
    oldNo?: number;
    newNo?: number;
  }

  const parsed = $derived.by(() => {
    if (diff === null) return null;
    const lines: Line[] = [];
    let binary = false;
    let started = false;
    let oldNo = 0;
    let newNo = 0;
    let adds = 0;
    let dels = 0;

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
        lines.push({ kind: "add", text: raw.slice(1), newNo: newNo++ });
        adds++;
      } else if (raw.startsWith("-")) {
        lines.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++ });
        dels++;
      } else if (raw.startsWith(" ")) {
        lines.push({ kind: "ctx", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
      }
    }
    return { lines, binary, adds, dels };
  });
</script>

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
    <div class="flex h-full items-center justify-center text-[13px] text-fg-faint">Binary file — no preview</div>
  {:else if parsed.lines.length === 0}
    <div class="flex h-full items-center justify-center text-[13px] text-fg-faint">No textual changes</div>
  {:else}
    <div class="sticky top-0 z-10 flex items-center gap-3 border-b border-line-soft bg-[oklch(0.08_0.012_320/0.7)] px-4 py-1.5 text-[12px] backdrop-blur-xl">
      <span class="font-semibold text-added">+{parsed.adds}</span>
      <span class="font-semibold text-deleted">−{parsed.dels}</span>
      <span class="flex h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
        {#if parsed.adds + parsed.dels > 0}
          <span class="bg-added" style:width="{(parsed.adds / (parsed.adds + parsed.dels)) * 100}%"></span>
          <span class="bg-deleted flex-1"></span>
        {/if}
      </span>
    </div>
    <table class="selectable w-full border-collapse font-mono text-[12px] leading-[20px] tracking-normal" class:opacity-60={loading}>
      <tbody>
        {#each parsed.lines as line}
          {#if line.kind === "hunk"}
            <tr class="bg-accent-soft/60">
              <td colspan="3" class="px-4 py-1 text-[12px] text-accent-fg/80">{line.text}</td>
            </tr>
          {:else}
            <tr class="row-{line.kind}">
              <td class="num">{line.oldNo ?? ""}</td>
              <td class="num">{line.newNo ?? ""}</td>
              <td class="code"><span class="sign">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>{line.text}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
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
  .sign {
    display: inline-block;
    width: 16px;
    user-select: none;
    -webkit-user-select: none;
    opacity: 0.7;
  }
  .row-add {
    background: color-mix(in oklch, var(--color-added) 11%, transparent);
  }
  .row-add .code {
    color: var(--color-fg);
  }
  .row-add .num,
  .row-add .sign {
    color: var(--color-added);
  }
  .row-del {
    background: color-mix(in oklch, var(--color-deleted) 11%, transparent);
  }
  .row-del .code {
    color: var(--color-fg);
  }
  .row-del .num,
  .row-del .sign {
    color: var(--color-deleted);
  }
  tr:not(.row-add):not(.row-del):hover {
    background: var(--color-surface-1);
  }
</style>

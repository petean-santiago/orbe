<script lang="ts">
  import { Cloud, GitBranch, Tag } from "@lucide/svelte";
  import { app } from "../state.svelte";
  import { relativeTime, shortDate } from "../format";
  import { settings, COLUMN_LABELS, type ColumnId } from "../settings.svelte";
  import type { Commit } from "../api";
  import type { GraphRow } from "../graph";
  import Avatar from "./Avatar.svelte";
  import { ui } from "../ui.svelte";
  import { commitMenu } from "../actions";

  const ROW = $derived(settings.rowHeight);
  const LANE = 16;
  const PAD = 14;
  const OVERSCAN = 8;
  const MAX_VISIBLE_LANES = 12;

  let viewport: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let height = $state(600);

  const lanes = $derived(Math.min(app.graph.maxLanes, MAX_VISIBLE_LANES));
  const graphWidth = $derived(PAD * 2 + (lanes - 1) * LANE);
  const total = $derived(app.commits.length);
  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN));
  const end = $derived(Math.min(total, Math.ceil((scrollTop + height) / ROW) + OVERSCAN));
  let listWidth = $state(1000);
  // Narrower metadata columns when space is tight.
  const WIDTHS = $derived<Record<Exclude<ColumnId, "graph" | "description">, string>>(
    listWidth < 1000 || settings.value.detailsPosition === "right"
      ? { author: "150px", date: "104px", hash: "76px" }
      : { author: "190px", date: "130px", hash: "88px" },
  );
  /** Keep the description readable: drop the least important columns first when narrow. */
  const MIN_DESCRIPTION = 280;
  const columns = $derived.by<ColumnId[]>(() => {
    let cols = settings.value.columns.filter((c) => c.visible).map((c) => c.id);
    const px = (id: ColumnId) => (id === "graph" ? graphWidth : id === "description" ? 0 : parseInt(WIDTHS[id]));
    for (const drop of ["hash", "date", "author"] as const) {
      if (listWidth - cols.reduce((sum, id) => sum + px(id), 0) >= MIN_DESCRIPTION) break;
      cols = cols.filter((c) => c !== drop);
    }
    return cols;
  });
  const template = $derived(
    columns
      .map((id) => (id === "graph" ? `${graphWidth}px` : id === "description" ? "minmax(0, 1fr)" : WIDTHS[id]))
      .join(" "),
  );
  const visible = $derived(app.commits.slice(start, end).map((c, i) => ({ c, i: start + i })));

  const x = (lane: number) => PAD + lane * LANE;

  function segmentPath(s: { fromLane: number; fromY: number; toLane: number; toY: number }) {
    const x1 = x(s.fromLane);
    const x2 = x(s.toLane);
    const y1 = s.fromY * ROW;
    const y2 = s.toY * ROW;
    if (x1 === x2) return `M${x1} ${y1}L${x2} ${y2}`;
    const my = (y1 + y2) / 2;
    return `M${x1} ${y1}C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
  }

  interface Pill {
    label: string;
    kind: "head" | "local" | "remote" | "tag";
    synced?: boolean;
  }

  function pills(refs: string[]): Pill[] {
    const out: Pill[] = [];
    const locals = new Set<string>();
    for (const r of refs) {
      if (r.startsWith("HEAD -> ")) {
        const name = r.slice(8);
        locals.add(name);
        out.push({ label: name, kind: "head" });
      } else if (r === "HEAD") {
        out.push({ label: "HEAD", kind: "head" });
      } else if (r.startsWith("tag: ")) {
        out.push({ label: r.slice(5), kind: "tag" });
      } else if (!r.includes("/") || app.branches.some((b) => b.kind === "local" && b.name === r)) {
        locals.add(r);
        out.push({ label: r, kind: "local" });
      }
    }
    for (const r of refs) {
      if (r.startsWith("HEAD") || r.startsWith("tag: ")) continue;
      if (locals.has(r)) continue;
      const short = r.split("/").slice(1).join("/");
      const local = out.find((p) => (p.kind === "local" || p.kind === "head") && p.label === short);
      if (local) local.synced = true;
      else out.push({ label: r, kind: "remote" });
    }
    return out;
  }

  function select(hash: string) {
    app.selectedHash = hash;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const idx = app.commits.findIndex((c) => c.hash === app.selectedHash);
    const next = Math.max(0, Math.min(total - 1, idx + (e.key === "ArrowDown" ? 1 : -1)));
    const commit = app.commits[next];
    if (!commit || !viewport) return;
    select(commit.hash);
    const top = next * ROW;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + ROW > viewport.scrollTop + viewport.clientHeight)
      viewport.scrollTop = top + ROW - viewport.clientHeight;
  }

  // Keep the selected commit in view when it changes from elsewhere (sidebar, palette).
  $effect(() => {
    const idx = app.commits.findIndex((c) => c.hash === app.selectedHash);
    if (idx < 0 || !viewport) return;
    const top = idx * ROW;
    if (top < viewport.scrollTop || top + ROW > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTo({ top: Math.max(0, top - viewport.clientHeight / 3), behavior: "smooth" });
    }
  });
</script>

{#snippet cell(id: ColumnId, c: Commit, row: GraphRow | undefined, selected: boolean, isHead: boolean)}
  {#if id === "graph"}
    <svg width={graphWidth} height={ROW} class="overflow-visible">
      {#if row}
        {#each row.segments as s}
          {#if s.fromLane < MAX_VISIBLE_LANES && s.toLane < MAX_VISIBLE_LANES}
            <path d={segmentPath(s)} stroke={s.color} stroke-width="2" fill="none" stroke-linecap="round" />
          {/if}
        {/each}
        {#if row.lane < MAX_VISIBLE_LANES}
          {#if isHead}
            <circle cx={x(row.lane)} cy={ROW / 2} r="9.5" fill={row.color} opacity="0.25" />
          {/if}
          {#if row.isMerge}
            <circle cx={x(row.lane)} cy={ROW / 2} r="4" fill="var(--color-base)" stroke={row.color} stroke-width="2" />
          {:else}
            <circle cx={x(row.lane)} cy={ROW / 2} r={isHead ? 6 : 5} fill={row.color} stroke="var(--color-base)" stroke-width="2" />
          {/if}
        {/if}
      {/if}
    </svg>
  {:else if id === "description"}
    <div class="flex min-w-0 items-center gap-1.5 pr-4 pl-2">
      {#each pills(c.refs) as p}
        <span
          class={[
            "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium",
            p.kind === "head" && "bg-accent-strong text-white shadow-[0_0_12px_-2px_var(--color-accent-glow)]",
            p.kind === "local" && "border border-accent/30 bg-accent-soft text-accent-fg",
            p.kind === "remote" && "border border-line bg-surface-2 text-fg-muted",
            p.kind === "tag" && "border border-modified/30 bg-modified/10 text-modified",
          ]}
        >
          {#if p.kind === "tag"}
            <Tag size={11} strokeWidth={2.4} />
          {:else if p.kind === "remote"}
            <Cloud size={11} strokeWidth={2.4} />
          {:else}
            <GitBranch size={11} strokeWidth={2.4} />
          {/if}
          {p.label}
          {#if p.synced}
            <Cloud size={11} strokeWidth={2.4} class="opacity-70" />
          {/if}
        </span>
      {/each}
      <span class={["truncate", selected || isHead ? "text-fg" : "text-fg-muted group-hover:text-fg", row?.isMerge && "text-fg-faint"]}>
        {c.subject}
      </span>
    </div>
  {:else if id === "author"}
    <div class="flex min-w-0 items-center gap-2 pr-4 text-fg-muted">
      {#if settings.value.showAvatars}<Avatar name={c.author} email={c.email} size={20} />{/if}
      <span class="truncate">{c.author}</span>
    </div>
  {:else if id === "date"}
    <div class="truncate pr-4 text-fg-faint tabular-nums">
      {settings.value.relativeDates ? relativeTime(c.timestamp) : shortDate(c.timestamp)}
    </div>
  {:else if id === "hash"}
    <div class="pr-4 font-mono text-[12px] text-fg-faint">{c.shortHash}</div>
  {/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col" bind:clientWidth={listWidth}>
  <div
    class="grid h-9 shrink-0 items-center border-b border-line-soft text-[11px] font-semibold tracking-[0.06em] text-fg-faint uppercase"
    style:grid-template-columns={template}
  >
    {#each columns as id (id)}
      <span class={id === "graph" ? "pl-3.5" : id === "description" ? "pl-2" : ""}>{COLUMN_LABELS[id]}</span>
    {/each}
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    bind:this={viewport}
    bind:clientHeight={height}
    onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
    onkeydown={onKey}
    tabindex="0"
    role="listbox"
    aria-label="Commit history"
    class="relative min-h-0 flex-1 overflow-y-auto outline-none"
  >
    {#if total === 0 && !app.loading}
      <div class="flex h-full items-center justify-center text-[13px] text-fg-faint">No commits yet</div>
    {/if}

    <div style:height="{total * ROW}px" class="relative">
      {#each visible as { c, i } (c.hash)}
        {@const row = app.graph.rows[i]}
        {@const selected = c.hash === app.selectedHash}
        {@const isHead = c.refs.some((r) => r.startsWith("HEAD"))}
        <div
          role="option"
          aria-selected={selected}
          tabindex="-1"
          class={[
            "group absolute inset-x-0 grid items-center text-[13px] transition-colors duration-75",
            selected ? "bg-gradient-to-r from-accent/22 via-accent/10 to-transparent" : "hover:bg-surface-2",
          ]}
          style:top="{i * ROW}px"
          style:height="{ROW}px"
          style:grid-template-columns={template}
          onclick={() => select(c.hash)}
          oncontextmenu={(e) => (select(c.hash), ui.menuAt(e, commitMenu(c)))}
          onkeydown={() => {}}
        >
          {#if selected}
            <span class="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-accent shadow-[0_0_12px_var(--color-accent)]"></span>
          {/if}
          {#each columns as id (id)}
            {@render cell(id, c, row, selected, isHead)}
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>

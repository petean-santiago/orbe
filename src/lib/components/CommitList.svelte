<script lang="ts">
  import { Check, CheckCheck, Cloud, CloudDownload, GitBranch, Tag } from "@lucide/svelte";
  import { app } from "../state.svelte";
  import { relativeTime, shortDate } from "../format";
  import { settings, COLUMN_LABELS, type ColumnId } from "../settings.svelte";
  import type { Commit } from "../api";
  import type { GraphRow } from "../graph";
  import Avatar from "./Avatar.svelte";
  import { ui } from "../ui.svelte";
  import { checkoutMenu, commitMenu } from "../actions";
  import { isDropTarget, startBranchDrag } from "../branchDrag.svelte";
  import type { Branch } from "../api";

  /** The branch a ref pill stands for, so it can be dragged. */
  function pillBranch(p: { label: string; kind: string }): Branch | null {
    if (p.kind === "tag" || p.label === "HEAD") return null;
    const kind = p.kind === "remote" ? "remote" : "local";
    return app.branches.find((b) => b.kind === kind && b.name === p.label) ?? null;
  }

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
      if (listWidth - 16 - cols.reduce((sum, id) => sum + px(id), 0) >= MIN_DESCRIPTION) break;
      cols = cols.filter((c) => c !== drop);
    }
    return cols;
  });
  /** Width left for the description column, which decides how many ref pills fit. */
  const descriptionWidth = $derived(
    listWidth - 16 - columns.filter((id) => id !== "description").reduce((sum, id) => sum + (id === "graph" ? graphWidth : parseInt(WIDTHS[id])), 0),
  );
  const maxPills = $derived(descriptionWidth < 380 ? 1 : descriptionWidth < 560 ? 2 : descriptionWidth < 800 ? 3 : 4);
  const pillMaxWidth = $derived(descriptionWidth < 480 ? 120 : 170);
  const PILL_ORDER = { head: 0, local: 1, tag: 2, remote: 3 } as const;

  /** How many loaded commits are waiting to be pushed / pulled (for the legend). */
  const pending = $derived.by(() => {
    let push = 0;
    let pull = 0;
    for (const state of app.active.sync.values()) {
      if (state === "push") push++;
      else if (state === "pull") pull++;
    }
    return { push, pull };
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

  // Double-click is detected by hand: the first click re-renders the row it
  // selects, and the browser then doesn't treat the second click as a dblclick.
  let lastClick = { hash: "", at: 0 };
  function onRowClick(e: MouseEvent, c: Commit) {
    const now = performance.now();
    if (lastClick.hash === c.hash && now - lastClick.at < 400) {
      lastClick = { hash: "", at: 0 };
      ui.menuAt(e, checkoutMenu(c));
      return;
    }
    lastClick = { hash: c.hash, at: now };
    select(c.hash);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && app.selectedHash) {
      e.preventDefault();
      app.selectedHash = null; // closes the details panel
      return;
    }
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
    {@const all = pills(c.refs).sort((a, b) => PILL_ORDER[a.kind] - PILL_ORDER[b.kind])}
    {@const shown = all.length > maxPills ? all.slice(0, maxPills) : all}
    {@const hidden = all.slice(shown.length)}
    {@const sync = app.active.sync.get(c.hash)}
    <div class="flex min-w-0 items-center gap-1.5 overflow-hidden px-3">
      {#if sync === "push"}
        <span class="flex w-4 shrink-0 justify-center text-accent" title="Committed locally, not pushed yet"><Check size={13} strokeWidth={2.6} /></span>
      {:else if sync === "pull"}
        <span class="flex w-4 shrink-0 justify-center text-[oklch(0.8_0.12_230)]" title="On the remote, not pulled yet"><CloudDownload size={13} strokeWidth={2.3} /></span>
      {:else if sync === "synced"}
        <span class="flex w-4 shrink-0 justify-center text-fg-faint/60" title="Pushed: already on the remote"><CheckCheck size={13} strokeWidth={2.3} /></span>
      {:else}
        <span class="w-4 shrink-0"></span>
      {/if}
      {#each shown as p}
        {@const branch = pillBranch(p)}
        <span
          role="presentation"
          data-branch-drop={p.kind === "head" || p.kind === "local" ? p.label : undefined}
          onpointerdown={(e) => branch && startBranchDrag(e, branch)}
          title={branch ? `${p.label}: drag onto another branch to merge` : undefined}
          class={[
            "inline-flex h-[22px] min-w-0 shrink items-center gap-1 rounded-full px-2 text-[11.5px] font-medium transition-[box-shadow,transform]",
            branch && "cursor-grab",
            (p.kind === "head" || p.kind === "local") && isDropTarget(p.label) && "scale-110 ring-2 ring-accent",
            p.kind === "head" && "bg-accent-strong text-white shadow-[0_0_12px_-2px_var(--color-accent-glow)]",
            p.kind === "local" && "border border-accent/30 bg-accent-soft text-accent-fg",
            p.kind === "remote" && "border border-line bg-surface-2 text-fg-muted",
            p.kind === "tag" && "border border-modified/30 bg-modified/10 text-modified",
          ]}
        >
          {#if p.kind === "tag"}
            <Tag size={11} strokeWidth={2.4} class="shrink-0" />
          {:else if p.kind === "remote"}
            <Cloud size={11} strokeWidth={2.4} class="shrink-0" />
          {:else}
            <GitBranch size={11} strokeWidth={2.4} class="shrink-0" />
          {/if}
          <span class="truncate" style:max-width="{pillMaxWidth}px">{p.label}</span>
          {#if p.synced}
            <Cloud size={11} strokeWidth={2.4} class="shrink-0 opacity-70" />
          {/if}
        </span>
      {/each}
      {#if hidden.length}
        <span
          class="inline-flex h-[22px] shrink-0 items-center rounded-full border border-line bg-surface-2 px-1.5 text-[11px] font-semibold text-fg-muted tabular-nums"
          title={hidden.map((p) => p.label).join("\n")}
        >
          +{hidden.length}
        </span>
      {/if}
      <span
        class={[
          "min-w-[60px] flex-1 truncate",
          sync === "push" && "font-semibold text-fg",
          sync === "pull" && "italic text-[oklch(0.8_0.06_230)] opacity-80",
          sync !== "push" && sync !== "pull" && (selected || isHead ? "text-fg" : "text-fg-muted group-hover:text-fg"),
          sync !== "push" && sync !== "pull" && row?.isMerge && "text-fg-faint",
        ]}
      >
        {c.subject}
      </span>
    </div>
  {:else if id === "author"}
    <div class="flex min-w-0 items-center gap-2 px-3 text-fg-muted">
      {#if settings.value.showAvatars}<Avatar name={c.author} email={c.email} size={20} />{/if}
      <span class="truncate">{c.author}</span>
    </div>
  {:else if id === "date"}
    <div class="truncate px-3 text-fg-faint tabular-nums">
      {settings.value.relativeDates ? relativeTime(c.timestamp) : shortDate(c.timestamp)}
    </div>
  {:else if id === "hash"}
    <div class="truncate px-3 font-mono text-[12px] text-fg-faint">{c.shortHash}</div>
  {/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col" bind:clientWidth={listWidth}>
  <div
    class="grid h-9 shrink-0 items-center border-b border-line-soft px-2 text-[11px] font-semibold tracking-[0.06em] text-fg-faint uppercase"
    style:grid-template-columns={template}
  >
    {#each columns as id (id)}
      {#if id === "description"}
        <span class="flex min-w-0 items-center gap-3 px-3">
          <span class="truncate">{COLUMN_LABELS[id]}</span>
          {#if pending.push || pending.pull}
            <!-- Legend, only when something is waiting -->
            <span class="flex items-center gap-2.5 font-normal tracking-normal normal-case">
              {#if pending.push}
                <span class="flex items-center gap-1 text-accent-fg" title="Commits you haven't pushed yet are shown in bold">
                  <Check size={12} strokeWidth={2.6} />{pending.push} to push
                </span>
              {/if}
              {#if pending.pull}
                <span class="flex items-center gap-1 text-[oklch(0.82_0.1_230)]" title="Commits on the remote you haven't pulled are shown in italics">
                  <CloudDownload size={12} strokeWidth={2.3} />{pending.pull} to pull
                </span>
              {/if}
              <span class="flex items-center gap-1 text-fg-faint" title="Already on the remote"><CheckCheck size={12} strokeWidth={2.3} />pushed</span>
            </span>
          {/if}
        </span>
      {:else}
        <span class={["truncate", id === "graph" ? "pl-1.5" : "px-3"]}>{COLUMN_LABELS[id]}</span>
      {/if}
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
            "group absolute inset-x-0 grid items-center px-2 text-[13px] transition-colors duration-75",
            selected ? "bg-gradient-to-r from-accent/22 via-accent/10 to-transparent" : "hover:bg-surface-2",
          ]}
          style:top="{i * ROW}px"
          style:height="{ROW}px"
          style:grid-template-columns={template}
          onclick={(e) => onRowClick(e, c)}
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

<script lang="ts">
  import {
    ChevronRight,
    ChevronsDownUp,
    FilePlus,
    FileText,
    FolderPlus,
    LoaderCircle,
    RefreshCw,
    Search,
    X,
  } from "@lucide/svelte";
  import type { FileStatus, TreeEntry } from "../api";
  import { app } from "../state.svelte";
  import { ui } from "../ui.svelte";
  import { STATUS_META } from "../format";
  import { fileMenu, newFile, newFolder } from "../actions";
  import FileViewer from "./FileViewer.svelte";
  import FileIcon from "./FileIcon.svelte";
  import FolderIcon from "./FolderIcon.svelte";
  import Resizer from "./Resizer.svelte";
  import { settings, DEFAULT_SIZES } from "../settings.svelte";

  const ROW = 28;
  const OVERSCAN = 10;

  const tab = $derived(app.active);
  let query = $state("");
  let viewport: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let height = $state(500);

  $effect(() => {
    if (!tab.treeLoaded && !tab.treeLoading) tab.loadTree();
  });

  // ---- tree structure -------------------------------------------------------

  const children = $derived.by(() => {
    const map = new Map<string, TreeEntry[]>();
    for (const e of tab.tree) {
      const i = e.path.lastIndexOf("/");
      const parent = i === -1 ? "" : e.path.slice(0, i);
      let list = map.get(parent);
      if (!list) map.set(parent, (list = []));
      list.push(e);
    }
    const name = (p: string) => p.slice(p.lastIndexOf("/") + 1);
    for (const list of map.values()) {
      list.sort((a, b) => Number(b.dir) - Number(a.dir) || name(a.path).localeCompare(name(b.path), undefined, { sensitivity: "base" }));
    }
    return map;
  });

  /** Path → change status (unstaged wins, conflicts always win). */
  const changes = $derived.by(() => {
    const map = new Map<string, FileStatus>();
    for (const s of tab.status) {
      const cur = map.get(s.path);
      if (!cur || s.status === "conflicted" || !s.staged) map.set(s.path, s.status);
    }
    return map;
  });

  const changedDirs = $derived.by(() => {
    const set = new Set<string>();
    for (const p of changes.keys()) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join("/"));
    }
    return set;
  });

  interface Row {
    entry: TreeEntry;
    depth: number;
    name: string;
    dir: string;
  }

  const rows = $derived.by<Row[]>(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return tab.tree
        .filter((e) => !e.dir && e.path.toLowerCase().includes(q))
        .slice(0, 500)
        .map((entry) => {
          const i = entry.path.lastIndexOf("/");
          return { entry, depth: 0, name: entry.path.slice(i + 1), dir: i === -1 ? "" : entry.path.slice(0, i) };
        });
    }
    const out: Row[] = [];
    const walk = (parent: string, depth: number) => {
      for (const entry of children.get(parent) ?? []) {
        out.push({ entry, depth, name: entry.path.slice(entry.path.lastIndexOf("/") + 1), dir: "" });
        if (entry.dir && tab.expanded.has(entry.path)) walk(entry.path, depth + 1);
      }
    };
    walk("", 0);
    return out;
  });

  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN));
  const end = $derived(Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN));
  const fileCount = $derived(tab.tree.filter((e) => !e.dir).length);

  // ---- interaction ------------------------------------------------------------

  function activate(row: Row) {
    if (row.entry.dir) {
      if (tab.expanded.has(row.entry.path)) tab.expanded.delete(row.entry.path);
      else tab.expanded.add(row.entry.path);
    } else {
      tab.selectedFile = row.entry.path;
    }
  }

  function scrollToIndex(i: number) {
    if (!viewport) return;
    const top = i * ROW;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + ROW > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = top + ROW - viewport.clientHeight;
  }

  let cursor = $state<string | null>(null);

  function onKey(e: KeyboardEvent) {
    const idx = rows.findIndex((r) => r.entry.path === (cursor ?? tab.selectedFile));
    const row = rows[idx];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))];
      if (!next) return;
      cursor = next.entry.path;
      if (!next.entry.dir) tab.selectedFile = next.entry.path;
      scrollToIndex(rows.indexOf(next));
    } else if (e.key === "ArrowRight" && row?.entry.dir) {
      e.preventDefault();
      tab.expanded.add(row.entry.path);
    } else if (e.key === "ArrowLeft" && row) {
      e.preventDefault();
      if (row.entry.dir && tab.expanded.has(row.entry.path)) tab.expanded.delete(row.entry.path);
      else {
        const parent = row.entry.path.split("/").slice(0, -1).join("/");
        if (parent) cursor = parent;
      }
    } else if (e.key === "Enter" && row) {
      e.preventDefault();
      activate(row);
    }
  }

</script>

<div class="flex h-full min-h-0">
  <!-- Tree -->
  <div class="flex shrink-0 flex-col border-r border-line-soft bg-black/15" style:width="min({settings.value.sizes.filesTree}px, 55%)">
    <div class="flex h-10 shrink-0 items-center gap-1 pr-2 pl-3.5">
      <span class="section-label flex-1 px-0">Project</span>
      {#if tab.treeLoading}<LoaderCircle size={13} class="mr-1 animate-spin text-fg-faint" />{/if}
      <button class="icon-btn size-7" title="New file…" onclick={() => newFile()}><FilePlus size={15} /></button>
      <button class="icon-btn size-7" title="New folder…" onclick={() => newFolder()}><FolderPlus size={15} /></button>
      <button class="icon-btn size-7" title="Collapse all" onclick={() => tab.expanded.clear()}><ChevronsDownUp size={15} /></button>
      <button class="icon-btn size-7" title="Reload files" onclick={() => tab.loadTree()}><RefreshCw size={14} /></button>
    </div>
    <div class="px-2.5 pb-2">
      <div class="glass-well flex h-8 items-center gap-2 rounded-lg px-2.5 focus-within:border-accent/50">
        <Search size={13} class="shrink-0 text-fg-faint" />
        <input
          bind:value={query}
          placeholder="Find a file…"
          spellcheck="false"
          class="min-w-0 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-fg-faint"
          onkeydown={(e) => {
            if (e.key === "Escape") query = "";
            if (e.key === "ArrowDown") viewport?.focus();
          }}
        />
        {#if query}<button class="icon-btn size-5" aria-label="Clear" onclick={() => (query = "")}><X size={12} /></button>{/if}
      </div>
    </div>

    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      bind:this={viewport}
      bind:clientHeight={height}
      role="tree"
      aria-label="Project files"
      tabindex="0"
      class="relative min-h-0 flex-1 overflow-y-auto pb-2 outline-none"
      onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
      onkeydown={onKey}
      oncontextmenu={(e) => ui.menuAt(e, fileMenu(null))}
    >
      {#if !tab.treeLoaded && tab.treeLoading}
        <div class="space-y-2 px-4 py-2">
          {#each Array(12) as _, i}
            <div class="h-3 animate-pulse rounded bg-surface-2" style:width="{35 + ((i * 29) % 50)}%" style:margin-left="{(i % 3) * 14}px"></div>
          {/each}
        </div>
      {:else if rows.length === 0}
        <p class="px-4 py-6 text-center text-[12.5px] text-fg-faint">{query ? "No matching files" : "This repository is empty"}</p>
      {/if}

      <div class="relative" style:height="{rows.length * ROW}px">
        {#each rows.slice(start, end) as row, k (row.entry.path)}
          {@const i = start + k}
          {@const e = row.entry}
          {@const open = e.dir && tab.expanded.has(e.path)}
          {@const status = changes.get(e.path)}
          {@const selected = !e.dir && tab.selectedFile === e.path}
          <div
            role="treeitem"
            aria-selected={selected}
            aria-expanded={e.dir ? open : undefined}
            tabindex="-1"
            class={[
              "group absolute inset-x-1.5 flex items-center gap-1.5 rounded-md pr-2 text-[13px] transition-colors duration-75",
              selected ? "bg-accent-soft text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
              cursor === e.path && !selected && "ring-1 ring-line ring-inset",
            ]}
            style:top="{i * ROW}px"
            style:height="{ROW}px"
            style:padding-left="{8 + row.depth * 14}px"
            onclick={() => ((cursor = e.path), activate(row))}
            onkeydown={() => {}}
            oncontextmenu={(ev) => ui.menuAt(ev, fileMenu(e))}
          >
            {#if e.dir}
              <ChevronRight size={12} strokeWidth={2.5} class={["shrink-0 text-fg-faint transition-transform duration-150", open && "rotate-90"]} />
            {:else}
              <span class="w-3 shrink-0"></span>
            {/if}
            {#if e.dir}
              <FolderIcon name={row.name} {open} size={15} />
            {:else}
              <FileIcon path={e.path} size={14} />
            {/if}
            <span class="min-w-0 flex-1 truncate" style:color={status ? STATUS_META[status].color : undefined}>
              {row.name}
              {#if row.dir}<span class="ml-1.5 text-[11.5px] text-fg-faint">{row.dir}</span>{/if}
            </span>
            {#if status}
              <span class="font-mono text-[11px] font-semibold" style:color={STATUS_META[status].color} title={STATUS_META[status].label}>
                {STATUS_META[status].letter}
              </span>
            {:else if e.dir && changedDirs.has(e.path)}
              <span class="size-1.5 rounded-full bg-modified/80" title="Contains changes"></span>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <div class="border-t border-line-soft px-3.5 py-2 text-[11.5px] text-fg-faint tabular-nums">
      {fileCount.toLocaleString()} files · {changes.size} changed
    </div>
  </div>

  <Resizer bind:value={settings.value.sizes.filesTree} min={200} max={640} initial={DEFAULT_SIZES.filesTree} label="Resize file tree" />

  <!-- Viewer -->
  <div class="min-w-0 flex-1">
    {#if tab.selectedFile}
      {#key tab.selectedFile}
        <FileViewer path={tab.selectedFile} status={changes.get(tab.selectedFile) ?? null} />
      {/key}
    {:else}
      <div class="flex h-full flex-col items-center justify-center gap-3 text-fg-faint">
        <div class="flex size-12 items-center justify-center glass rounded-2xl text-accent"><FileText size={20} /></div>
        <p class="font-display text-[18px] text-fg-muted">Pick a file to view it</p>
        <p class="text-[12px]">Right-click in the tree to create, rename or delete</p>
      </div>
    {/if}
  </div>
</div>

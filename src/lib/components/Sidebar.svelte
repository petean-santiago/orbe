<script lang="ts">
  import {
    ArrowRightLeft,
    ChevronRight,
    Cloud,
    FileDiff,
    Folder,
    FolderTree,
    GitBranch,
    GitGraph,
    LoaderCircle,
    PanelLeftClose,
    PanelLeftOpen,
    PanelRightClose,
    PanelRightOpen,
    Plus,
    Search,
    Tag,
    X,
  } from "@lucide/svelte";
  import { slide } from "svelte/transition";
  import { SvelteSet } from "svelte/reactivity";
  import type { Branch } from "../api";
  import { app, type View } from "../state.svelte";
  import { settings } from "../settings.svelte";
  import { ui } from "../ui.svelte";
  import { branchMenu, newBranch, newTag } from "../actions";

  type SectionKey = "local" | "remote" | "tags";

  /** Icons-only rail: chosen explicitly, or automatic on narrow windows. */
  const rail = $derived(ui.sidebarRail);
  const onRight = $derived(settings.value.sidebarSide === "right");

  function toggleRail() {
    settings.value.sidebarMode = rail ? "open" : "icons";
  }

  let open = $state<Record<SectionKey, boolean>>({ local: true, remote: true, tags: false });
  const collapsed = new SvelteSet<string>();
  let filter = $state("");
  let revealed = $state<string | null>(null);

  const q = $derived(filter.trim().toLowerCase());
  const matches = (b: Branch) => !q || b.name.toLowerCase().includes(q);
  const local = $derived(app.branches.filter((b) => b.kind === "local" && matches(b)));
  const remote = $derived(app.branches.filter((b) => b.kind === "remote" && matches(b)));
  const tags = $derived(
    app.branches.filter((b) => b.kind === "tag" && matches(b)).sort((a, b) => b.updated - a.updated),
  );

  const nav: { view: View; label: string; icon: typeof GitGraph }[] = [
    { view: "changes", label: "Changes", icon: FileDiff },
    { view: "history", label: "History", icon: GitGraph },
    { view: "files", label: "Files", icon: FolderTree },
  ];

  interface Group {
    folder: string | null;
    items: { branch: Branch; label: string }[];
  }

  /** Group "feature/x" and "feature/y" under a "feature" folder (remotes by remote name). */
  function group(list: Branch[], byRemote: boolean): Group[] {
    const groups = new Map<string | null, Group>();
    for (const b of list) {
      const i = b.name.indexOf("/");
      const folder = i === -1 ? null : b.name.slice(0, i);
      const label = i === -1 ? b.name : b.name.slice(i + 1);
      const key = folder;
      if (!groups.has(key)) groups.set(key, { folder, items: [] });
      groups.get(key)!.items.push({ branch: b, label });
    }
    let out = [...groups.values()];
    if (!byRemote) {
      // A folder holding a single branch reads better as a plain row.
      const loose = groups.get(null) ?? { folder: null, items: [] };
      for (const g of out) {
        if (g.folder !== null && g.items.length === 1) loose.items.push({ branch: g.items[0].branch, label: g.items[0].branch.name });
      }
      out = [loose, ...out.filter((g) => g.folder !== null && g.items.length > 1)].filter((g) => g.items.length);
    }
    // Loose branches first (main, develop), then folders alphabetically.
    out.sort((a, b) => (a.folder === null ? -1 : b.folder === null ? 1 : a.folder.localeCompare(b.folder)));
    for (const g of out) {
      g.items.sort((a, b) => Number(b.branch.isHead) - Number(a.branch.isHead) || a.label.localeCompare(b.label));
    }
    return out;
  }

  function reveal(b: Branch) {
    revealed = b.kind + b.name;
    const refName = b.kind === "tag" ? `tag: ${b.name}` : b.name;
    const commit = app.commits.find((c) => c.refs.some((r) => r === refName || r === `HEAD -> ${b.name}`));
    if (commit) {
      app.view = "history";
      app.selectedHash = commit.hash;
    }
  }
</script>

{#snippet branchRow(b: Branch, label: string, Icon: typeof GitBranch, indent: boolean)}
  {@const pending = app.active.pendingCheckout === b.name}
  {@const isRevealed = revealed === b.kind + b.name}
  <li>
    <div
      role="button"
      tabindex="0"
      class={[
        "group relative flex h-8 w-full cursor-default items-center gap-2.5 rounded-md pr-1.5 text-left text-[13px] transition-colors",
        indent ? "pl-7" : "pl-2.5",
        b.isHead ? "bg-surface-2 text-fg" : isRevealed ? "bg-surface-2/60 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      ]}
      title={b.kind === "tag"
        ? `${b.name}: click to show, right-click for actions`
        : b.isHead
          ? `${b.name} (current branch)`
          : `${b.name}: click to show, double-click to switch, right-click for actions`}
      onclick={() => reveal(b)}
      ondblclick={() => b.kind !== "tag" && app.checkout(b)}
      onkeydown={(e) => e.key === "Enter" && reveal(b)}
      oncontextmenu={(e) => ui.menuAt(e, branchMenu(b))}
    >
      {#if pending}
        <LoaderCircle size={13} class="shrink-0 animate-spin text-accent" />
      {:else}
        <Icon size={13} strokeWidth={2} class={["shrink-0", b.isHead ? "text-accent" : "text-fg-faint group-hover:text-fg-muted"]} />
      {/if}
      <span class="min-w-0 flex-1 truncate">{label}</span>
      {#if b.behind > 0}
        <span class="text-[11px] text-fg-faint tabular-nums group-hover:hidden">↓{b.behind}</span>
      {/if}
      {#if b.ahead > 0}
        <span class="text-[11px] text-accent-fg tabular-nums group-hover:hidden">↑{b.ahead}</span>
      {/if}
      {#if b.isHead}
        <span class="mr-1 size-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]"></span>
      {:else if b.kind !== "tag" && !pending}
        <button
          class="hidden h-6 items-center gap-1 rounded-md border border-accent/30 bg-accent-soft px-1.5 text-[11px] font-medium text-accent-fg group-hover:inline-flex hover:border-accent/60"
          title="Switch to {b.name}"
          onclick={(e) => (e.stopPropagation(), app.checkout(b))}
          ondblclick={(e) => e.stopPropagation()}
        >
          <ArrowRightLeft size={11} /> Switch
        </button>
      {/if}
    </div>
  </li>
{/snippet}

{#snippet section(key: SectionKey, label: string, items: Branch[], Icon: typeof GitBranch, onadd?: () => void)}
  <div class="mt-3">
    <div class="group flex items-center pr-2">
      <button class="flex flex-1 items-center gap-1 text-left" onclick={() => (open[key] = !open[key])}>
        <span class="section-label flex flex-1 items-center gap-1 pr-0">
          <ChevronRight size={11} strokeWidth={2.5} class="-ml-1 transition-transform duration-200 {open[key] ? 'rotate-90' : ''}" />
          {label}
        </span>
        <span class="text-[11px] text-fg-faint tabular-nums">{items.length}</span>
      </button>
      {#if onadd}
        <button class="icon-btn ml-1 size-6 opacity-0 group-hover:opacity-100 focus:opacity-100" title="New {label === 'Tags' ? 'tag' : 'branch'}…" onclick={onadd}>
          <Plus size={13} />
        </button>
      {/if}
    </div>
    {#if open[key] || q}
      <ul transition:slide={{ duration: 180 }} class="mt-1 px-2">
        {#if key === "tags"}
          {#each items as b (b.name)}
            {@render branchRow(b, b.name, Icon, false)}
          {/each}
        {:else}
          {#each group(items, key === "remote") as g (g.folder ?? "")}
            {#if g.folder === null}
              {#each g.items as { branch, label } (branch.name)}
                {@render branchRow(branch, label, Icon, false)}
              {/each}
            {:else}
              {@const fkey = `${key}:${g.folder}`}
              {@const folderOpen = !collapsed.has(fkey) || !!q}
              <li>
                <button
                  class="flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12.5px] text-fg-faint transition-colors hover:bg-surface-2 hover:text-fg-muted"
                  onclick={() => (collapsed.has(fkey) ? collapsed.delete(fkey) : collapsed.add(fkey))}
                >
                  <ChevronRight size={11} strokeWidth={2.5} class={["-ml-0.5 shrink-0 transition-transform duration-150", folderOpen && "rotate-90"]} />
                  {#if key === "remote"}<Cloud size={13} class="shrink-0" />{:else}<Folder size={13} class="shrink-0" />{/if}
                  <span class="min-w-0 flex-1 truncate">{g.folder}</span>
                  <span class="text-[11px] tabular-nums">{g.items.length}</span>
                </button>
              </li>
              {#if folderOpen}
                {#each g.items as { branch, label } (branch.name)}
                  {@render branchRow(branch, label, key === "remote" ? GitBranch : Icon, true)}
                {/each}
              {/if}
            {/if}
          {/each}
        {/if}
        {#if items.length === 0}
          <li class="px-2.5 py-1 text-[12px] text-fg-faint italic">{q ? "No matches" : "None"}</li>
        {/if}
      </ul>
    {/if}
  </div>
{/snippet}

{#if rail}
  <aside class="glass flex w-[56px] shrink-0 flex-col items-center gap-1 overflow-hidden rounded-2xl py-2">
    {#each nav as item}
      {@const active = app.view === item.view}
      {@const count = item.view === "changes" ? app.status.length : 0}
      <button
        class={[
          "relative flex size-10 items-center justify-center rounded-xl transition-colors",
          active ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
        ]}
        title={item.label}
        onclick={() => (app.view = item.view)}
      >
        {#if active}
          <span class="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]"></span>
        {/if}
        <item.icon size={18} />
        {#if count > 0}
          <span class="absolute top-1 right-1 min-w-4 rounded-full bg-accent-strong px-1 text-[9.5px] leading-4 font-bold text-white tabular-nums">
            {count > 99 ? "99+" : count}
          </span>
        {/if}
      </button>
    {/each}
    <div class="my-1.5 h-px w-7 bg-line-soft"></div>
    <button class="flex size-10 items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg" title="Switch branch" onclick={() => (ui.branchSwitcher = true)}>
      <GitBranch size={18} />
    </button>
    <button class="flex size-10 items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg" title="New branch…" onclick={() => newBranch()}>
      <Plus size={18} />
    </button>
    <div class="flex-1"></div>
    <button class="flex size-10 items-center justify-center rounded-xl text-fg-faint transition-colors hover:bg-surface-2 hover:text-fg" title="Show full sidebar" onclick={toggleRail}>
      {#if onRight}<PanelRightOpen size={17} />{:else}<PanelLeftOpen size={17} />{/if}
    </button>
  </aside>
{:else}
<aside class="glass flex shrink-0 flex-col overflow-hidden rounded-2xl" style:width="min({settings.value.sizes.sidebar}px, 34vw)">
  <div class="min-h-0 flex-1 overflow-y-auto pt-2 pb-4">
    {#each settings.value.sidebarSections.filter((sec) => sec.visible) as sec (sec.id)}
      {#if sec.id === "workspace"}
        <nav class="flex flex-col gap-0.5 px-2 pt-1 pb-1">
          {#each nav as item}
            {@const active = app.view === item.view}
            {@const count = item.view === "changes" ? app.status.length : 0}
            <button
              class={[
                "relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors",
                active ? "bg-accent-soft text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
              ]}
              onclick={() => (app.view = item.view)}
            >
              {#if active}
                <span class="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]"></span>
              {/if}
              <item.icon size={16} class={active ? "text-accent" : ""} />
              <span class="flex-1 text-left">{item.label}</span>
              {#if count > 0}
                <span class="rounded-full bg-surface-4 px-2 text-[11px] leading-[18px] font-semibold text-fg tabular-nums">{count}</span>
              {/if}
            </button>
          {/each}
        </nav>
        {#if app.branches.length > 6}
          <div class="mx-2.5 mt-3 flex h-8 items-center gap-2 rounded-lg border border-transparent bg-surface-1 px-2.5 transition-colors focus-within:border-accent/40">
            <Search size={13} class="shrink-0 text-fg-faint" />
            <input
              bind:value={filter}
              placeholder="Filter branches & tags"
              spellcheck="false"
              class="min-w-0 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-fg-faint"
              onkeydown={(e) => e.key === "Escape" && (filter = "")}
            />
            {#if filter}<button class="icon-btn size-5" aria-label="Clear filter" onclick={() => (filter = "")}><X size={12} /></button>{/if}
          </div>
        {/if}
      {:else if sec.id === "branches"}
        {@render section("local", "Branches", local, GitBranch, () => newBranch())}
      {:else if sec.id === "remotes"}
        {@render section("remote", "Remotes", remote, Cloud)}
      {:else if sec.id === "tags"}
        {@render section("tags", "Tags", tags, Tag, () => newTag())}
      {/if}
    {/each}
  </div>

  <div class="flex items-center gap-1 border-t border-line-soft py-1.5 pr-1.5 pl-3.5">
    <span class="selectable min-w-0 flex-1 truncate font-mono text-[11px] text-fg-faint" title={app.repo?.path}>{app.repo?.path ?? ""}</span>
    <button class="icon-btn size-7 shrink-0" title="Icons only" onclick={toggleRail}>
      {#if onRight}<PanelRightClose size={15} />{:else}<PanelLeftClose size={15} />{/if}
    </button>
  </div>
</aside>
{/if}

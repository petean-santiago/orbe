<script lang="ts">
  import {
    Archive,
    ArchiveRestore,
    ArrowDown,
    ArrowUp,
    Download,
    FileDiff,
    FilePlus,
    FileSearch,
    FolderOpen,
    FolderPlus,
    FolderTree,
    GitBranchPlus,
    ListChecks,
    Sparkles,
    Tag,
    GitBranch,
    GitCommitHorizontal,
    GitGraph,
    RefreshCw,
    Plus,
    Search,
    Settings,
  } from "@lucide/svelte";
  import { fade, scale } from "svelte/transition";
  import { app } from "../state.svelte";
  import { relativeTime } from "../format";
  import { ui } from "../ui.svelte";
  import { cloneRepository, createRepository, newBranch, newFile, newFolder, newTag, stashChanges } from "../actions";
  import { reviewStaged, summarizeChanges } from "../assistant.svelte";

  interface Item {
    id: string;
    group: string;
    label: string;
    hint?: string;
    icon: typeof Search;
    run: () => void;
  }

  let query = $state("");
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();

  const actions: Item[] = [
    { id: "a-changes", group: "Actions", label: "Go to Changes", icon: FileDiff, run: () => (app.view = "changes") },
    { id: "a-history", group: "Actions", label: "Go to History", icon: GitGraph, run: () => (app.view = "history") },
    { id: "a-files", group: "Actions", label: "Go to Files", icon: FolderTree, run: () => (app.view = "files") },
    { id: "a-switch", group: "Actions", label: "Switch branch…", icon: GitBranch, run: () => (ui.branchSwitcher = true) },
    { id: "a-branch", group: "Create", label: "New branch…", icon: GitBranchPlus, run: () => newBranch() },
    { id: "a-tag", group: "Create", label: "New tag…", icon: Tag, run: () => newTag() },
    { id: "a-file", group: "Create", label: "New file…", icon: FilePlus, run: () => newFile() },
    { id: "a-folder", group: "Create", label: "New folder…", icon: FolderPlus, run: () => newFolder() },
    { id: "a-stash", group: "Create", label: "Stash changes…", icon: Archive, run: () => stashChanges() },
    { id: "a-pop", group: "Create", label: "Apply latest stash", icon: ArchiveRestore, run: () => app.active.stashPop() },
    { id: "a-clone", group: "Create", label: "Clone repository…", icon: Download, run: () => cloneRepository() },
    { id: "a-init", group: "Create", label: "New repository…", icon: FolderPlus, run: () => createRepository() },
    { id: "ai-panel", group: "AI", label: "Open AI assistant", icon: Sparkles, run: () => (ui.assistant = true) },
    { id: "ai-summary", group: "AI", label: "Summarize my changes", icon: FileSearch, run: () => summarizeChanges(app.active) },
    { id: "ai-review", group: "AI", label: "Review staged changes", icon: ListChecks, run: () => reviewStaged(app.active) },
    { id: "a-fetch", group: "Actions", label: "Fetch all remotes", icon: RefreshCw, run: () => app.remote("fetch") },
    { id: "a-pull", group: "Actions", label: "Pull", icon: ArrowDown, run: () => app.remote("pull") },
    { id: "a-push", group: "Actions", label: "Push", icon: ArrowUp, run: () => app.remote("push") },
    { id: "a-refresh", group: "Actions", label: "Refresh", icon: RefreshCw, run: () => app.refresh() },
    { id: "a-open", group: "Actions", label: "Open repository in new tab…", icon: FolderOpen, run: () => app.openFolder() },
    { id: "a-tab", group: "Actions", label: "New tab", icon: Plus, run: () => app.newTab() },
    { id: "a-settings", group: "Actions", label: "Open settings", icon: Settings, run: () => (app.settingsOpen = true) },
  ];

  const items = $derived.by<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (...fields: string[]) => !q || fields.some((f) => f.toLowerCase().includes(q));

    const branchItems: Item[] = app.branches
      .filter((b) => b.kind !== "tag" && !b.isHead && match(b.name))
      // Hide remotes that already have a local tracking branch.
      .filter((b) => b.kind !== "remote" || !app.branches.some((l) => l.upstream === b.name))
      .slice(0, 8)
      .map((b) => ({
        id: `b-${b.kind}-${b.name}`,
        group: "Switch branch",
        label: b.name,
        hint: b.kind === "remote" ? "remote" : undefined,
        icon: GitBranch,
        run: () => app.checkout(b),
      }));

    const commitItems: Item[] = q
      ? app.commits
          .filter((c) => match(c.subject, c.hash, c.author))
          .slice(0, 12)
          .map((c) => ({
            id: `c-${c.hash}`,
            group: "Commits",
            label: c.subject,
            hint: `${c.shortHash} · ${c.author} · ${relativeTime(c.timestamp)}`,
            icon: GitCommitHorizontal,
            run: () => {
              app.view = "history";
              app.selectedHash = c.hash;
            },
          }))
      : [];

    return [...actions.filter((a) => match(a.label)), ...branchItems, ...commitItems];
  });

  $effect(() => {
    void query;
    active = 0;
  });

  $effect(() => {
    input?.focus();
  });

  function close() {
    app.paletteOpen = false;
  }

  function run(item: Item | undefined) {
    if (!item) return;
    close();
    item.run();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = items.length;
      if (!n) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      listEl?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(items[active]);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  role="presentation"
  class="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[12vh] backdrop-blur-[3px]"
  transition:fade={{ duration: 120 }}
  onclick={close}
>
  <div
    role="dialog"
    aria-label="Command palette"
    tabindex="-1"
    class="w-[min(600px,calc(100vw-32px))] overflow-hidden glass-strong rounded-2xl"
    transition:scale={{ start: 0.97, duration: 160 }}
    onclick={(e) => e.stopPropagation()}
    onkeydown={onKey}
  >
    <div class="flex items-center gap-3 border-b border-line px-4">
      <Search size={16} class="text-accent" />
      <input
        bind:this={input}
        bind:value={query}
        placeholder="Type a command, branch or commit…"
        class="h-12 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-faint"
      />
      <span class="kbd">esc</span>
    </div>

    <div bind:this={listEl} class="max-h-[420px] overflow-y-auto p-1.5">
      {#each items as item, i (item.id)}
        {#if i === 0 || items[i - 1].group !== item.group}
          <div class="section-label px-2.5 pt-2.5 pb-1.5">{item.group}</div>
        {/if}
        <button
          data-idx={i}
          class={[
            "flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-left text-[13px] transition-colors duration-75",
            i === active ? "bg-accent-soft text-fg" : "text-fg-muted",
          ]}
          onmousemove={() => (active = i)}
          onclick={() => run(item)}
        >
          <item.icon size={15} class={i === active ? "text-accent" : "text-fg-faint"} />
          <span class="min-w-0 flex-1 truncate">{item.label}</span>
          {#if item.hint}
            <span class="max-w-[45%] shrink-0 truncate font-mono text-[11px] text-fg-faint">{item.hint}</span>
          {/if}
        </button>
      {:else}
        <div class="px-3 py-8 text-center text-[13px] text-fg-faint">No results for “{query}”</div>
      {/each}
    </div>
  </div>
</div>

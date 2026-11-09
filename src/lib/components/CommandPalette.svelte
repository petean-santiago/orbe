<script lang="ts">
  /**
   * "Jump to anything": search actions, branches, commits and files in one
   * place, with a live preview of the highlighted result and a way to hand the
   * query to the AI assistant.
   *
   * Scopes: type a prefix ( > actions, @ branches, # commits, / files ) or
   * press Tab to cycle through the scope tabs.
   */
  import {
    Archive,
    ArchiveRestore,
    ArrowDown,
    ArrowRightLeft,
    ArrowUp,
    Cloud,
    CornerDownLeft,
    Download,
    FileDiff,
    FilePlus,
    FileSearch,
    FolderOpen,
    FolderPlus,
    FolderTree,
    GitBranch,
    GitBranchPlus,
    GitCommitHorizontal,
    GitGraph,
    Layers,
    ListChecks,
    Plus,
    RefreshCw,
    Settings,
    Sparkles,
    Tag,
  } from "@lucide/svelte";
  import { fade, scale } from "svelte/transition";
  import { git, type Branch, type Commit, type FileChange } from "../api";
  import { app } from "../state.svelte";
  import { ui, type Icon } from "../ui.svelte";
  import { groupLabel, newGroup } from "../tabGroups";
  import { fuzzyMatch, matchScore, modKey, relativeTime, shortDate } from "../format";
  import { tokenize, isItalic, type ThemedToken } from "../highlight";
  import { cloneRepository, createRepository, newBranch, newFile, newFolder, newTag, stashChanges } from "../actions";
  import { aiReady, reviewStaged, send, summarizeChanges } from "../assistant.svelte";
  import Avatar from "./Avatar.svelte";
  import FileIcon from "./FileIcon.svelte";
  import StatusBadge from "./StatusBadge.svelte";

  type Scope = "all" | "actions" | "branches" | "commits" | "files";

  interface Item {
    id: string;
    kind: "action" | "branch" | "commit" | "file" | "ai";
    group: string;
    label: string;
    hint?: string;
    keys?: string;
    icon?: Icon;
    hits?: number[];
    run: () => void;
    branch?: Branch;
    commit?: Commit;
    path?: string;
    description?: string;
  }

  const SCOPES: { id: Scope; label: string; prefix: string; icon: Icon }[] = [
    { id: "all", label: "All", prefix: "", icon: Sparkles },
    { id: "actions", label: "Actions", prefix: ">", icon: CornerDownLeft },
    { id: "branches", label: "Branches", prefix: "@", icon: GitBranch },
    { id: "commits", label: "Commits", prefix: "#", icon: GitCommitHorizontal },
    { id: "files", label: "Files", prefix: "/", icon: FolderTree },
  ];

  const tab = $derived(app.active);
  let raw = $state("");
  let scope = $state<Scope>("all");
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();
  let width = $state(900);

  // A leading prefix switches scope, then is removed from the query.
  $effect(() => {
    const s = SCOPES.find((x) => x.prefix && raw.startsWith(x.prefix));
    if (s) {
      scope = s.id;
      raw = raw.slice(1).trimStart();
    }
  });

  // Files are searchable too; load the tree the first time.
  $effect(() => {
    if (!tab.treeLoaded && !tab.treeLoading) tab.loadTree();
  });

  const query = $derived(raw.trim());

  const actions: Omit<Item, "kind" | "group">[] = [
    { id: "a-changes", label: "Go to Changes", icon: FileDiff, keys: `${modKey} 1`, run: () => (app.view = "changes"), description: "Stage files and commit." },
    { id: "a-history", label: "Go to History", icon: GitGraph, keys: `${modKey} 2`, run: () => (app.view = "history"), description: "Browse commits and the branch graph." },
    { id: "a-files", label: "Go to Files", icon: FolderTree, keys: `${modKey} 3`, run: () => (app.view = "files"), description: "The whole project as a tree." },
    { id: "a-switch", label: "Switch branch…", icon: ArrowRightLeft, keys: `${modKey} B`, run: () => (ui.branchSwitcher = true), description: "Search and switch branches." },
    { id: "a-branch", label: "New branch…", icon: GitBranchPlus, run: () => newBranch(), description: "Create a branch from the current commit." },
    { id: "a-tag", label: "New tag…", icon: Tag, run: () => newTag(), description: "Tag the current commit." },
    { id: "a-file", label: "New file…", icon: FilePlus, run: () => newFile(), description: "Create a file in the repository." },
    { id: "a-folder", label: "New folder…", icon: FolderPlus, run: () => newFolder(), description: "Create a folder in the repository." },
    { id: "a-stash", label: "Stash changes…", icon: Archive, run: () => stashChanges(), description: "Put uncommitted changes aside." },
    { id: "a-pop", label: "Apply latest stash", icon: ArchiveRestore, run: () => app.active.stashPop(), description: "Bring back the most recent stash." },
    { id: "a-fetch", label: "Fetch all remotes", icon: RefreshCw, run: () => app.remote("fetch"), description: "Download new commits without changing your files." },
    { id: "a-pull", label: "Pull", icon: ArrowDown, run: () => app.remote("pull"), description: "Bring in commits from the upstream branch." },
    { id: "a-push", label: "Push", icon: ArrowUp, run: () => app.remote("push"), description: "Send your commits to the remote." },
    { id: "a-refresh", label: "Refresh", icon: RefreshCw, keys: `${modKey} R`, run: () => app.refresh(), description: "Re-read the repository state." },
    { id: "a-ai", label: "Open AI assistant", icon: Sparkles, keys: `${modKey} J`, run: () => (ui.assistant = true), description: "Chat about this repository." },
    { id: "a-summary", label: "Summarize my changes with AI", icon: FileSearch, run: () => summarizeChanges(app.active), description: "Explain what your uncommitted changes do." },
    { id: "a-review", label: "Review staged changes with AI", icon: ListChecks, run: () => reviewStaged(app.active), description: "Look for bugs before committing." },
    { id: "a-clone", label: "Clone repository…", icon: Download, run: () => cloneRepository(), description: "Copy a repository from a URL." },
    { id: "a-init", label: "New repository…", icon: FolderPlus, run: () => createRepository(), description: "Create an empty repository." },
    { id: "a-open", label: "Open repository in new tab…", icon: FolderOpen, keys: `${modKey} O`, run: () => app.openFolder(), description: "Open a folder that contains a Git repository." },
    { id: "a-tab", label: "New tab", icon: Plus, keys: `${modKey} T`, run: () => app.newTab(), description: "Open another repository side by side." },
    { id: "a-settings", label: "Open settings", icon: Settings, keys: `${modKey} ,`, run: () => (app.settingsOpen = true), description: "Colours, fonts, layout and AI." },
    { id: "a-group", label: "New tab group…", icon: Layers, run: () => newGroup(app.active), description: "Group related repositories so they open together." },
    ...app.groups
      .filter((g) => g.paths.length)
      .map((g) => ({
        id: `a-group-${g.id}`,
        label: `Open group: ${groupLabel(g)}`,
        icon: Layers,
        run: () => app.openGroup(g.id),
        description: `${g.paths.length} repositor${g.paths.length === 1 ? "y" : "ies"}, opened side by side.`,
      })),
  ];

  /** Rank by match quality and keep the best `limit`. */
  function rank<T>(list: T[], text: (x: T) => string, limit: number): { x: T; hits: number[] }[] {
    if (!query) return list.slice(0, limit).map((x) => ({ x, hits: [] }));
    const out: { x: T; hits: number[]; score: number }[] = [];
    for (const x of list) {
      const hits = fuzzyMatch(text(x), query);
      if (hits) out.push({ x, hits, score: matchScore(hits) });
    }
    return out.sort((a, b) => a.score - b.score).slice(0, limit);
  }

  const items = $derived.by<Item[]>(() => {
    const all = scope === "all";
    const want = (s: Scope) => all || scope === s;
    const out: Item[] = [];

    if (want("actions")) {
      for (const { x, hits } of rank(actions, (a) => a.label, all ? (query ? 5 : 6) : 50)) {
        out.push({ ...x, kind: "action", group: "Actions", hits });
      }
    }
    if (want("branches")) {
      const branches = app.branches
        .filter((b) => b.kind !== "tag")
        // Remotes already tracked by a local branch are reached through it.
        .filter((b) => b.kind !== "remote" || !app.branches.some((l) => l.upstream === b.name))
        .sort((a, b) => Number(b.isHead) - Number(a.isHead) || b.updated - a.updated);
      for (const { x: b, hits } of rank(branches, (b) => b.name, all ? 5 : 60)) {
        out.push({
          id: `b-${b.kind}-${b.name}`,
          kind: "branch",
          group: "Branches",
          label: b.name,
          hint: b.isHead ? "current" : b.kind === "remote" ? "remote" : undefined,
          icon: b.kind === "remote" ? Cloud : GitBranch,
          hits,
          branch: b,
          run: () => !b.isHead && app.checkout(b),
        });
      }
    }
    if (want("commits") && (query || !all)) {
      const ranked = rank(app.commits, (c) => `${c.subject} ${c.shortHash} ${c.author}`, all ? 6 : 80);
      for (const { x: c, hits } of ranked) {
        out.push({
          id: `c-${c.hash}`,
          kind: "commit",
          group: "Commits",
          label: c.subject,
          hint: c.shortHash,
          icon: GitCommitHorizontal,
          hits: hits.filter((i) => i < c.subject.length),
          commit: c,
          run: () => {
            app.view = "history";
            app.selectedHash = c.hash;
          },
        });
      }
    }
    if (want("files") && (query || !all)) {
      const files = tab.tree.filter((e) => !e.dir);
      for (const { x: f, hits } of rank(files, (f) => f.path, all ? 6 : 80)) {
        out.push({
          id: `f-${f.path}`,
          kind: "file",
          group: "Files",
          label: f.path,
          path: f.path,
          hits,
          run: () => tab.openFile(f.path),
        });
      }
    }
    // Anything that reads like a question can go straight to the assistant.
    if (query && (all || scope === "actions")) {
      out.push({
        id: "ai-ask",
        kind: "ai",
        group: "Ask AI",
        label: query,
        icon: Sparkles,
        run: () => send(app.active, query),
        description: aiReady() ? "Send this to the assistant." : "Set up an AI provider first.",
      });
    }
    return out;
  });

  const current = $derived(items[active]);
  const counts = $derived.by(() => {
    const c: Record<string, number> = {};
    for (const i of items) c[i.group] = (c[i.group] ?? 0) + 1;
    return c;
  });

  $effect(() => {
    void query;
    void scope;
    active = 0;
  });

  $effect(() => {
    input?.focus();
  });

  // ---- preview ------------------------------------------------------------------

  let commitFiles = $state<FileChange[] | null>(null);
  let filePreview = $state.raw<{ lines: string[]; tokens: ThemedToken[][] | null } | null>(null);

  $effect(() => {
    const item = current;
    const repo = app.repo;
    commitFiles = null;
    filePreview = null;
    if (!item || !repo) return;
    let cancelled = false;
    // Small delay so flying through the list with the arrows stays smooth.
    const timer = setTimeout(async () => {
      if (item.commit) {
        const files = await git.commitFiles(repo.path, item.commit.hash).catch(() => []);
        if (!cancelled) commitFiles = files;
      } else if (item.path) {
        const content = await git.readFile(repo.path, item.path).catch(() => null);
        if (cancelled || !content?.text) return;
        const lines = content.text.split("\n").slice(0, 40);
        filePreview = { lines, tokens: null };
        const tokens = await tokenize(lines.join("\n"), item.path);
        if (!cancelled) filePreview = { lines, tokens };
      }
    }, 90);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  const tipCommit = $derived.by(() => {
    const b = current?.branch;
    if (!b) return null;
    return app.commits.find((c) => c.refs.some((r) => r === b.name || r === `HEAD -> ${b.name}`)) ?? null;
  });

  // ---- keyboard -------------------------------------------------------------------

  function close() {
    app.paletteOpen = false;
  }

  function run(item: Item | undefined) {
    if (!item) return;
    close();
    item.run();
  }

  function cycleScope(dir: 1 | -1) {
    const i = SCOPES.findIndex((s) => s.id === scope);
    scope = SCOPES[(i + dir + SCOPES.length) % SCOPES.length].id;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (scope !== "all" && !raw) scope = "all";
      else close();
    } else if (e.key === "Tab") {
      e.preventDefault();
      cycleScope(e.shiftKey ? -1 : 1);
    } else if (e.key === "Backspace" && !raw && scope !== "all") {
      scope = "all";
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

  const showPreview = $derived(width >= 760);
</script>

<svelte:window bind:innerWidth={width} />

{#snippet highlight(text: string, hits: number[] | undefined)}
  {#if !hits?.length}{text}{:else}{#each text as ch, i}{#if hits.includes(i)}<mark class="bg-transparent font-semibold text-accent-fg">{ch}</mark>{:else}{ch}{/if}{/each}{/if}
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  role="presentation"
  class="fixed inset-0 z-40 flex items-start justify-center bg-black/55 pt-[10vh] backdrop-blur-[3px]"
  transition:fade={{ duration: 120 }}
  onclick={close}
>
  <div
    role="dialog"
    aria-label="Jump to anything"
    tabindex="-1"
    class={["glass-strong flex flex-col overflow-hidden rounded-[20px]", showPreview ? "w-[min(880px,calc(100vw-48px))]" : "w-[min(600px,calc(100vw-32px))]"]}
    transition:scale={{ start: 0.97, duration: 160 }}
    onclick={(e) => e.stopPropagation()}
    onkeydown={onKey}
  >
    <!-- Query -->
    <div class="flex items-center gap-3 px-5 pt-4 pb-3">
      {#if scope !== "all"}
        {@const s = SCOPES.find((x) => x.id === scope)!}
        <button
          class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-2.5 text-[12.5px] font-medium text-accent-fg"
          title="Back to all (Backspace)"
          onclick={() => ((scope = "all"), input?.focus())}
        >
          <s.icon size={13} />
          {s.label}
        </button>
      {:else}
        <span class="orb shrink-0" aria-hidden="true"></span>
      {/if}
      <input
        bind:this={input}
        bind:value={raw}
        spellcheck="false"
        placeholder={scope === "all" ? "Jump to a branch, commit, file or action…" : `Search ${scope}…`}
        class="h-9 min-w-0 flex-1 bg-transparent text-[16px] text-fg outline-none placeholder:text-fg-faint"
      />
      <span class="kbd">esc</span>
    </div>

    <!-- Scope tabs -->
    <div class="flex items-center gap-1 border-b border-line px-4 pb-2.5">
      {#each SCOPES as s (s.id)}
        <button
          class={[
            "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] transition-colors",
            scope === s.id ? "bg-surface-4 text-fg" : "text-fg-faint hover:bg-surface-2 hover:text-fg-muted",
          ]}
          onclick={() => ((scope = s.id), input?.focus())}
        >
          {s.label}
          {#if s.prefix}<span class="font-mono text-[11px] opacity-60">{s.prefix}</span>{/if}
        </button>
      {/each}
      <span class="flex-1"></span>
      <span class="text-[11px] text-fg-faint"><span class="kbd">Tab</span> to switch</span>
    </div>

    <div class="flex h-[min(440px,58vh)] min-h-0">
      <!-- Results -->
      <div bind:this={listEl} class={["min-h-0 overflow-y-auto p-2", showPreview ? "w-[52%] border-r border-line-soft" : "flex-1"]}>
        {#each items as item, i (item.id)}
          {#if i === 0 || items[i - 1].group !== item.group}
            <div class="flex items-center gap-2 px-2.5 pt-2.5 pb-1.5">
              <span class="section-label px-0">{item.group}</span>
              {#if item.kind !== "ai"}<span class="text-[11px] text-fg-faint tabular-nums">{counts[item.group]}</span>{/if}
            </div>
          {/if}
          {@const on = i === active}
          <button
            data-idx={i}
            class={[
              "relative flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[13px] transition-colors duration-75",
              on ? "bg-accent-soft text-fg" : "text-fg-muted",
            ]}
            onmousemove={() => (active = i)}
            onclick={() => run(item)}
          >
            {#if on}<span class="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent shadow-[0_0_10px_var(--color-accent)]"></span>{/if}
            {#if item.kind === "file"}
              <FileIcon path={item.path!} size={15} />
            {:else if item.icon}
              <item.icon size={15} class={on ? "text-accent" : "text-fg-faint"} />
            {/if}
            <span class="min-w-0 flex-1 truncate">
              {#if item.kind === "ai"}
                Ask AI: <span class="text-fg">“{item.label}”</span>
              {:else}
                {@render highlight(item.label, item.hits)}
              {/if}
            </span>
            {#if item.keys}
              <span class="shrink-0 font-mono text-[11px] text-fg-faint">{item.keys}</span>
            {:else if item.hint}
              <span class="shrink-0 font-mono text-[11px] text-fg-faint">{item.hint}</span>
            {/if}
          </button>
        {:else}
          <div class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p class="text-[13px] text-fg-muted">Nothing matches “{query}”</p>
            <p class="text-[12px] text-fg-faint">Try another scope with <span class="kbd">Tab</span></p>
          </div>
        {/each}
      </div>

      <!-- Preview -->
      {#if showPreview}
        <div class="min-h-0 min-w-0 flex-1 overflow-y-auto bg-black/20">
          {#if !current}
            <div class="flex h-full items-center justify-center text-[12.5px] text-fg-faint">No selection</div>
          {:else if current.commit}
            {@const c = current.commit}
            <div class="p-5" in:fade={{ duration: 100 }}>
              <h3 class="font-display text-[17px] leading-snug text-fg">{c.subject}</h3>
              <div class="mt-3 flex items-center gap-2.5">
                <Avatar name={c.author} email={c.email} size={26} />
                <div class="min-w-0 leading-tight">
                  <div class="truncate text-[13px] text-fg">{c.author}</div>
                  <div class="text-[12px] text-fg-faint">{relativeTime(c.timestamp)} · {shortDate(c.timestamp)}</div>
                </div>
              </div>
              <div class="mt-3 font-mono text-[12px] text-fg-faint">{c.shortHash}</div>
              <div class="mt-4 section-label px-0">Files</div>
              <div class="mt-1.5 flex flex-col gap-1">
                {#if commitFiles === null}
                  {#each Array(3) as _}<div class="h-3 w-2/3 animate-pulse rounded bg-surface-2"></div>{/each}
                {:else}
                  {#each commitFiles.slice(0, 12) as f (f.path)}
                    <div class="flex items-center gap-2 text-[12.5px] text-fg-muted">
                      <StatusBadge status={f.status} />
                      <FileIcon path={f.path} size={13} />
                      <span class="truncate">{f.path}</span>
                    </div>
                  {/each}
                  {#if commitFiles.length > 12}<div class="text-[12px] text-fg-faint">+{commitFiles.length - 12} more</div>{/if}
                {/if}
              </div>
            </div>
          {:else if current.branch}
            {@const b = current.branch}
            <div class="p-5" in:fade={{ duration: 100 }}>
              <div class="flex items-center gap-2 text-fg-faint">
                {#if b.kind === "remote"}<Cloud size={15} />{:else}<GitBranch size={15} />{/if}
                <span class="text-[12px]">{b.kind === "remote" ? "Remote branch" : b.isHead ? "Current branch" : "Local branch"}</span>
              </div>
              <h3 class="mt-1.5 font-display text-[19px] break-all text-fg">{b.name}</h3>
              <div class="mt-3 flex flex-wrap gap-1.5 text-[12px]">
                {#if b.upstream}<span class="rounded-md bg-surface-3 px-2 py-0.5 text-fg-muted">tracks {b.upstream}</span>{/if}
                {#if b.ahead}<span class="rounded-md bg-accent-soft px-2 py-0.5 text-accent-fg">{b.ahead} ahead</span>{/if}
                {#if b.behind}<span class="rounded-md bg-surface-3 px-2 py-0.5 text-fg-muted">{b.behind} behind</span>{/if}
                {#if b.updated}<span class="rounded-md bg-surface-3 px-2 py-0.5 text-fg-muted">updated {relativeTime(b.updated)}</span>{/if}
              </div>
              {#if tipCommit}
                <div class="mt-5 section-label px-0">Latest commit</div>
                <div class="mt-1.5 rounded-xl border border-line-soft bg-surface-1 p-3">
                  <div class="text-[13px] text-fg">{tipCommit.subject}</div>
                  <div class="mt-1 text-[12px] text-fg-faint">{tipCommit.author} · {relativeTime(tipCommit.timestamp)}</div>
                </div>
              {/if}
              {#if !b.isHead}<p class="mt-4 text-[12px] text-fg-faint"><span class="kbd">↵</span> switch to this branch</p>{/if}
            </div>
          {:else if current.path}
            <div class="flex h-full flex-col" in:fade={{ duration: 100 }}>
              <div class="flex items-center gap-2 border-b border-line-soft px-4 py-2.5 text-[12.5px] text-fg-muted">
                <FileIcon path={current.path} size={14} />
                <span class="truncate">{current.path}</span>
              </div>
              {#if filePreview}
                <pre class="min-h-0 flex-1 overflow-hidden px-4 py-3 font-mono text-[11.5px] leading-[18px] text-fg-muted">{#if filePreview.tokens}{#each filePreview.tokens as line}{#each line as t}<span style:color={t.color} class:italic={isItalic(t)}>{t.content}</span>{/each}{"\n"}{/each}{:else}{filePreview.lines.join("\n")}{/if}</pre>
              {:else}
                <div class="space-y-2 p-4">{#each Array(8) as _, i}<div class="h-2.5 animate-pulse rounded bg-surface-2" style:width="{30 + ((i * 37) % 55)}%"></div>{/each}</div>
              {/if}
            </div>
          {:else}
            <div class="flex h-full flex-col items-center justify-center gap-3 px-8 text-center" in:fade={{ duration: 100 }}>
              <span class="flex size-12 items-center justify-center rounded-2xl border border-accent/25 bg-accent-soft text-accent">
                {#if current.icon}<current.icon size={20} />{/if}
              </span>
              <div class="font-display text-[16px] text-fg">{current.kind === "ai" ? "Ask the assistant" : current.label}</div>
              {#if current.description}<p class="text-[12.5px] text-fg-faint">{current.description}</p>{/if}
              {#if current.keys}<span class="font-mono text-[12px] text-fg-muted">{current.keys}</span>{/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <footer class="flex items-center gap-4 border-t border-line-soft bg-black/25 px-4 py-2 text-[11px] text-fg-faint">
      <span><span class="kbd">↑</span> <span class="kbd">↓</span> move</span>
      <span><span class="kbd">↵</span> open</span>
      <span class="hidden sm:inline"><span class="font-mono text-fg-muted">&gt; @ # /</span> scopes</span>
      <span class="flex-1"></span>
      <span>{items.length} result{items.length === 1 ? "" : "s"}</span>
    </footer>
  </div>
</div>

<style>
  /* A tiny orbiting dot instead of the usual magnifying glass. */
  .orb {
    position: relative;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    background: radial-gradient(circle at 35% 30%, oklch(0.92 0.08 var(--accent-h)), oklch(0.62 0.24 var(--accent-h)) 60%, oklch(0.38 0.16 var(--accent-h)));
    box-shadow: 0 0 14px oklch(0.7 0.24 var(--accent-h) / 0.55);
  }
  .orb::after {
    content: "";
    position: absolute;
    inset: -5px;
    border-radius: 999px;
    border: 1.5px solid oklch(1 0 0 / 0.55);
    border-left-color: transparent;
    border-bottom-color: transparent;
    animation: orb-spin 3.2s linear infinite;
  }
  @keyframes orb-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .orb::after {
      animation: none;
    }
  }
</style>

<script lang="ts">
  import { fade } from "svelte/transition";
  import { app } from "./lib/state.svelte";
  import { settings } from "./lib/settings.svelte";
  import { isTauri } from "./lib/api";
  import { ui, type SettingsPage } from "./lib/ui.svelte";
  import { newBranch } from "./lib/actions";
  import Ambient from "./lib/components/Ambient.svelte";
  import AssistantPanel from "./lib/components/AssistantPanel.svelte";
  import BranchSwitcher from "./lib/components/BranchSwitcher.svelte";
  import ContextMenu from "./lib/components/ContextMenu.svelte";
  import FilesView from "./lib/components/FilesView.svelte";
  import FormDialog from "./lib/components/FormDialog.svelte";
  import BranchDragGhost from "./lib/components/BranchDragGhost.svelte";
  import OperationBanner from "./lib/components/OperationBanner.svelte";
  import DetachedBanner from "./lib/components/DetachedBanner.svelte";
  import { branchDrag } from "./lib/branchDrag.svelte";
  import ChangesView from "./lib/components/ChangesView.svelte";
  import CommandPalette from "./lib/components/CommandPalette.svelte";
  import HistoryView from "./lib/components/HistoryView.svelte";
  import SettingsPanel from "./lib/components/SettingsPanel.svelte";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import TitleBar from "./lib/components/TitleBar.svelte";
  import Toasts from "./lib/components/Toasts.svelte";
  import Toolbar from "./lib/components/Toolbar.svelte";
  import Resizer from "./lib/components/Resizer.svelte";
  import { DEFAULT_SIZES } from "./lib/settings.svelte";
  import Welcome from "./lib/components/Welcome.svelte";

  // Persist + apply preferences whenever they change.
  $effect(() => {
    void JSON.stringify(settings.value); // track every nested field
    settings.apply();
  });

  function onKey(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    const handled = () => e.preventDefault();

    // Ctrl+←/→ moves between tabs, Ctrl+↑/↓ between groups. Text fields keep
    // their own Ctrl+arrow (word jumps), and overlays keep the keyboard.
    if (key.startsWith("arrow") && !e.shiftKey && !e.altKey) {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
      const overlay = app.paletteOpen || app.settingsOpen || ui.form || ui.menu || ui.branchSwitcher;
      if (typing || overlay) return;
      handled();
      if (key === "arrowleft") app.stepTab(-1);
      else if (key === "arrowright") app.stepTab(1);
      else if (key === "arrowup") app.stepGroup(-1);
      else app.stepGroup(1);
      return;
    }

    if (key === "\\" && app.repo) {
      handled();
      settings.value.sidebarMode = ui.sidebarRail ? "open" : "icons";
    } else if (key === "b" && app.repo) {
      handled();
      if (e.shiftKey) newBranch();
      else ui.branchSwitcher = !ui.branchSwitcher;
    } else if (key === "j" && app.repo) {
      handled();
      ui.assistant = !ui.assistant;
    } else if (key === "3" && app.repo) {
      handled();
      app.view = "files";
    } else if (key === "tab") {
      handled();
      app.cycleTab(e.shiftKey ? -1 : 1);
    } else if (key === "t") {
      handled();
      app.newTab();
    } else if (key === "w") {
      handled();
      app.closeTab(app.activeId);
    } else if (key === ",") {
      handled();
      if (!app.settingsOpen) ui.settingsPage = "appearance";
      app.settingsOpen = !app.settingsOpen;
    } else if (key === "k" && app.repo) {
      handled();
      app.paletteOpen = !app.paletteOpen;
    } else if (key === "o") {
      handled();
      app.openFolder();
    } else if (key === "r" && app.repo) {
      handled();
      app.refresh();
    } else if (key === "1" && app.repo) {
      handled();
      app.view = "changes";
    } else if (key === "2" && app.repo) {
      handled();
      app.view = "history";
    }
  }

  // Reopen last session's tabs, then apply browser-preview helpers:
  //   ?demo            open the demo repo        ?demo=2   open two demo tabs
  //   &view=changes    start in Changes          &palette  open the palette
  //   &settings=page   open Settings on a page        &view=files  start in Files
  //   &assistant       open the AI panel             &switcher    open the branch switcher
  //   &conflict        start mid-merge with conflicts to resolve
  const params = new URLSearchParams(location.search);
  if (params.get("settings")) ui.settingsPage = params.get("settings") as SettingsPage;

  (async () => {
    await app.restoreTabs();
    if (!isTauri && params.has("demo")) {
      if (params.get("demo") === "2") await app.open("/Users/demo/projects/nebula");
      await app.open("/Users/demo/projects/aurora");
      const view = params.get("view");
      if (view === "changes" || view === "files") app.view = view;
      if (params.has("conflict")) app.view = "changes";
      if (params.has("palette")) app.paletteOpen = true;
      if (params.has("assistant")) ui.assistant = true;
      if (params.has("switcher")) ui.branchSwitcher = true;
      if (params.has("settings")) app.settingsOpen = true;
    }
  })();

  // Fetch in the background so "to pull" counts stay current.
  $effect(() => {
    const minutes = settings.value.autoFetch;
    if (!minutes || !isTauri) return;
    const run = () => app.tabs.forEach((t) => t.repo && t.backgroundFetch());
    const first = setTimeout(run, 20_000); // shortly after launch
    const every = setInterval(run, minutes * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  });

  // Pick up changes made outside Orbe (editor, terminal) when the window regains focus.
  function onFocus() {
    if (app.repo) app.refresh();
  }
</script>

<svelte:window onkeydown={onKey} onfocus={onFocus} bind:innerWidth={ui.width} bind:innerHeight={ui.height} />

{#if settings.value.ambient}
  <Ambient />
{/if}

<div class="relative flex h-full flex-col">
  <TitleBar />

  {#key app.activeId}
    {#if app.repo}
      <Toolbar />
      {#if app.active.operation}
        <OperationBanner />
      {:else if app.active.detached}
        <DetachedBanner />
      {/if}
      <div
        class={["relative flex min-h-0 flex-1 gap-2 px-2 pb-2", settings.value.sidebarSide === "right" && "flex-row-reverse"]}
        in:fade={{ duration: 160 }}
      >
        <Sidebar />
        {#if !ui.sidebarRail}
          <Resizer bind:value={settings.value.sizes.sidebar} min={200} max={440} initial={DEFAULT_SIZES.sidebar} class="-mx-1" label="Resize sidebar" />
        {/if}
        <main class="glass relative min-w-0 flex-1 overflow-hidden rounded-2xl">
          {#if app.view === "history"}
            <div class="absolute inset-0" in:fade={{ duration: 140 }}><HistoryView /></div>
          {:else if app.view === "files"}
            <div class="absolute inset-0" in:fade={{ duration: 140 }}><FilesView /></div>
          {:else}
            <div class="absolute inset-0" in:fade={{ duration: 140 }}><ChangesView /></div>
          {/if}
        </main>
        {#if ui.assistant}
          {#if !ui.assistantFloats}
            <Resizer bind:value={settings.value.sizes.assistant} min={300} max={720} initial={DEFAULT_SIZES.assistant} panel="next" class="-mx-1" label="Resize assistant" />
          {/if}
          <AssistantPanel floating={ui.assistantFloats} />
        {/if}
      </div>
    {:else}
      <div class="min-h-0 flex-1" in:fade={{ duration: 160 }}><Welcome /></div>
    {/if}
  {/key}
</div>

{#if app.paletteOpen}
  <CommandPalette />
{/if}

{#if app.settingsOpen}
  <SettingsPanel initial={ui.settingsPage} />
{/if}

{#if ui.branchSwitcher && app.repo}
  <BranchSwitcher />
{/if}

{#if ui.form}
  {#key ui.form}
    <FormDialog />
  {/key}
{/if}

{#if branchDrag.source}
  <BranchDragGhost />
{/if}

{#if ui.menu}
  {#key ui.menu}
    <ContextMenu />
  {/key}
{/if}

<Toasts />

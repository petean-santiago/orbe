<script lang="ts">
  import { fade } from "svelte/transition";
  import { app } from "./lib/state.svelte";
  import { settings } from "./lib/settings.svelte";
  import { isTauri } from "./lib/api";
  import Ambient from "./lib/components/Ambient.svelte";
  import ChangesView from "./lib/components/ChangesView.svelte";
  import CommandPalette from "./lib/components/CommandPalette.svelte";
  import HistoryView from "./lib/components/HistoryView.svelte";
  import SettingsPanel from "./lib/components/SettingsPanel.svelte";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import TitleBar from "./lib/components/TitleBar.svelte";
  import Toasts from "./lib/components/Toasts.svelte";
  import Toolbar from "./lib/components/Toolbar.svelte";
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

    if (key === "tab") {
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
  //   &settings=page   open Settings on a page
  const params = new URLSearchParams(location.search);
  const settingsPage = (params.get("settings") || "appearance") as "appearance" | "typography" | "layout" | "arrange";

  (async () => {
    await app.restoreTabs();
    if (!isTauri && params.has("demo")) {
      if (params.get("demo") === "2") await app.open("/Users/demo/projects/nebula");
      await app.open("/Users/demo/projects/aurora");
      if (params.get("view") === "changes") app.view = "changes";
      if (params.has("palette")) app.paletteOpen = true;
      if (params.has("settings")) app.settingsOpen = true;
    }
  })();

  // Pick up changes made outside Orbe (editor, terminal) when the window regains focus.
  function onFocus() {
    if (app.repo) app.refresh();
  }
</script>

<svelte:window onkeydown={onKey} onfocus={onFocus} />

{#if settings.value.ambient}
  <Ambient />
{/if}

<div class="relative flex h-full flex-col">
  <TitleBar />

  {#key app.activeId}
    {#if app.repo}
      <Toolbar />
      <div
        class={["flex min-h-0 flex-1 gap-2 px-2 pb-2", settings.value.sidebarSide === "right" && "flex-row-reverse"]}
        in:fade={{ duration: 160 }}
      >
        <Sidebar />
        <main class="glass relative min-w-0 flex-1 overflow-hidden rounded-2xl">
          {#if app.view === "history"}
            <div class="absolute inset-0" in:fade={{ duration: 140 }}><HistoryView /></div>
          {:else}
            <div class="absolute inset-0" in:fade={{ duration: 140 }}><ChangesView /></div>
          {/if}
        </main>
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
  <SettingsPanel initial={settingsPage} />
{/if}

<Toasts />

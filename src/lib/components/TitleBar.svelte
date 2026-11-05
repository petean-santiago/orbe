<script lang="ts">
  import { LoaderCircle, Plus, Settings, X } from "@lucide/svelte";
  import { app, type RepoTab } from "../state.svelte";
  import { isMac, modKey } from "../format";
  import Logo from "./Logo.svelte";
  import Sortable from "./Sortable.svelte";
  import WindowControls from "./WindowControls.svelte";

  function onAux(e: MouseEvent, tab: RepoTab) {
    // Middle-click closes a tab, like in a browser.
    if (e.button === 1) {
      e.preventDefault();
      app.closeTab(tab.id);
    }
  }
</script>

<header
  data-tauri-drag-region
  class={["relative flex h-11 shrink-0 items-center gap-2 pr-0", isMac ? "pl-[80px]" : "pl-3"]}
>
  <div data-tauri-drag-region class="flex shrink-0 items-center pr-1">
    <Logo size={24} />
  </div>

  <div class="flex min-w-0 items-center gap-1">
    <Sortable
      items={app.tabs}
      key={(t) => t.id}
      onreorder={(tabs) => app.reorderTabs(tabs)}
      axis="x"
      class="min-w-0 gap-1"
      itemClass="min-w-0 w-[200px] shrink"
    >
      {#snippet children(tab, { dragging })}
        {@const active = tab.id === app.activeId}
        {@const changes = tab.status.length}
        <div
          role="tab"
          tabindex="0"
          aria-selected={active}
          title={tab.repo?.path ?? "New tab"}
          onclick={() => app.activate(tab.id)}
          onkeydown={(e) => e.key === "Enter" && app.activate(tab.id)}
          onauxclick={(e) => onAux(e, tab)}
          class={[
            "group relative flex h-8 w-full min-w-0 items-center gap-2 rounded-lg pr-1 pl-3 text-[13px] transition-colors duration-150",
            active ? "glass text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            dragging && "glass-strong shadow-2xl",
          ]}
        >
          {#if active}
            <span class="absolute inset-x-3 -bottom-px h-px bg-gradient-to-r from-transparent via-accent to-transparent"></span>
          {/if}
          {#if tab.loading || tab.remoteOp}
            <LoaderCircle size={13} class="shrink-0 animate-spin text-accent" />
          {:else}
            <span
              class={[
                "size-2 shrink-0 rounded-full",
                tab.repo ? (active ? "bg-accent shadow-[0_0_8px_var(--color-accent)]" : "bg-fg-faint/60") : "border border-fg-faint",
              ]}
            ></span>
          {/if}
          <span class={["min-w-0 flex-1 truncate", active && "font-semibold"]}>{tab.title}</span>
          {#if changes > 0}
            <span class="shrink-0 rounded-full bg-surface-3 px-1.5 text-[11px] leading-4 text-fg-muted tabular-nums group-hover:hidden">
              {changes}
            </span>
          {/if}
          <button
            data-no-drag
            class={[
              "icon-btn size-6 shrink-0 rounded-md",
              changes > 0 ? "hidden group-hover:inline-flex" : active ? "" : "opacity-0 group-hover:opacity-100",
            ]}
            aria-label="Close tab"
            title="Close tab ({modKey} W)"
            onclick={(e) => {
              e.stopPropagation();
              app.closeTab(tab.id);
            }}
          >
            <X size={13} />
          </button>
        </div>
      {/snippet}
    </Sortable>

    <button class="icon-btn size-8 shrink-0 rounded-lg" title="New tab ({modKey} T)" aria-label="New tab" onclick={() => app.newTab()}>
      <Plus size={16} />
    </button>
  </div>

  <div data-tauri-drag-region class="h-full min-w-6 flex-1"></div>

  <button
    class="icon-btn size-8 shrink-0 rounded-lg"
    title="Settings ({modKey} ,)"
    aria-label="Settings"
    onclick={() => (app.settingsOpen = true)}
  >
    <Settings size={16} />
  </button>

  {#if !isMac}
    <div class="h-full"><WindowControls /></div>
  {:else}
    <div class="w-2"></div>
  {/if}
</header>

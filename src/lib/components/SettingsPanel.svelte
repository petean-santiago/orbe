<script lang="ts">
  import {
    Check,
    Columns3,
    LayoutPanelLeft,
    Palette,
    PanelLeft,
    PanelRight,
    RotateCcw,
    Rows2,
    Columns2,
    Sparkles,
    Type,
    X,
  } from "@lucide/svelte";
  import { fade, fly } from "svelte/transition";
  import { app } from "../state.svelte";
  import {
    DEFAULT_SIZES,
    ACCENTS,
    COLUMN_LABELS,
    MONO_FONTS,
    SECTION_LABELS,
    TOOLBAR_LABELS,
    UI_FONTS,
    TITLE_FONTS,
    settings,
  } from "../settings.svelte";
  import { confirmAction } from "../api";
  import Segmented from "./Segmented.svelte";
  import SortableList from "./SortableList.svelte";
  import Switch from "./Switch.svelte";
  import AiSettings from "./AiSettings.svelte";
  import type { SettingsPage } from "../ui.svelte";

  type Page = SettingsPage;
  let { initial = "appearance" }: { initial?: Page } = $props();
  // svelte-ignore state_referenced_locally
  let page = $state<Page>(initial);

  const pages: { id: Page; label: string; hint: string; icon: typeof Palette }[] = [
    { id: "appearance", label: "Appearance", hint: "Colour, glass and density", icon: Palette },
    { id: "typography", label: "Typography", hint: "Interface and code fonts", icon: Type },
    { id: "layout", label: "Layout", hint: "Where panels live", icon: LayoutPanelLeft },
    { id: "arrange", label: "Arrange", hint: "Drag to reorder, toggle to hide", icon: Columns3 },
    { id: "ai", label: "AI assistant", hint: "Claude, OpenAI, local models", icon: Sparkles },
  ];

  const s = $derived(settings.value);

  function close() {
    app.settingsOpen = false;
  }

  async function reset() {
    if (await confirmAction("Reset all settings to their defaults?", "Reset settings", "Reset")) settings.reset();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#snippet row(title: string, hint: string, control: import("svelte").Snippet)}
  <div class="flex items-center gap-6 border-b border-line-soft py-4 last:border-b-0 @max-[520px]:flex-col @max-[520px]:items-start @max-[520px]:gap-3">
    <div class="min-w-0 flex-1">
      <div class="text-[14px] font-medium text-fg">{title}</div>
      <div class="mt-0.5 text-[12.5px] text-fg-faint">{hint}</div>
    </div>
    <div class="shrink-0">{@render control()}</div>
  </div>
{/snippet}

{#snippet group(title: string)}
  <h3 class="mt-7 mb-2 text-[11px] font-semibold tracking-[0.06em] text-fg-faint uppercase first:mt-0">{title}</h3>
{/snippet}

<!-- Light backdrop: changes preview live on the app behind the panel. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  role="presentation"
  class="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-6 max-[800px]:p-3"
  transition:fade={{ duration: 140 }}
  onclick={close}
>
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Settings"
    tabindex="-1"
    class="@container/dialog glass-strong flex h-[min(680px,100%)] w-[min(960px,100%)] overflow-hidden rounded-2xl"
    transition:fly={{ y: 10, duration: 200 }}
    onclick={(e) => e.stopPropagation()}
  >
    <!-- Navigation -->
    <nav class="flex w-[230px] shrink-0 flex-col border-r border-line-soft bg-black/20 p-3 @max-[820px]/dialog:w-[64px] @max-[820px]/dialog:p-2">
      <div class="px-2 pt-2 pb-5 @max-[820px]/dialog:hidden">
        <div class="font-display text-[18px] font-semibold tracking-[-0.02em] text-fg">Settings</div>
        <div class="mt-1 text-[12px] text-fg-faint">Make Orbe yours</div>
      </div>
      {#each pages as p (p.id)}
        {@const active = page === p.id}
        <button
          class={[
            "relative mb-0.5 flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors @max-[820px]/dialog:justify-center @max-[820px]/dialog:px-0",
            active ? "bg-accent-soft" : "hover:bg-surface-2",
          ]}
          onclick={() => (page = p.id)}
          title={p.label}
        >
          {#if active}
            <span class="absolute top-3 bottom-3 left-0 w-[3px] rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]"></span>
          {/if}
          <p.icon size={17} class={["mt-0.5 shrink-0", active ? "text-accent" : "text-fg-faint"]} />
          <span class="min-w-0 @max-[820px]/dialog:hidden">
            <span class={["block text-[13.5px] font-medium", active ? "text-fg" : "text-fg-muted"]}>{p.label}</span>
            <span class="block truncate text-[11.5px] text-fg-faint">{p.hint}</span>
          </span>
        </button>
      {/each}
      <div class="flex-1"></div>
      <button class="btn h-9 justify-center @max-[820px]/dialog:px-0" onclick={reset} title="Reset to defaults">
        <RotateCcw size={14} /> <span class="@max-[820px]/dialog:hidden">Reset to defaults</span>
      </button>
    </nav>

    <!-- Content -->
    <section class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-16 shrink-0 items-center justify-between border-b border-line-soft px-8 @max-[820px]/dialog:px-5">
        <h2 class="font-display text-[21px] text-fg">{pages.find((p) => p.id === page)?.label}</h2>
        <button class="icon-btn size-8 rounded-lg" aria-label="Close settings" onclick={close}><X size={17} /></button>
      </header>

      <div class="@container min-h-0 flex-1 overflow-y-auto px-8 py-6 @max-[820px]/dialog:px-5">
        {#key page}
          <div in:fade={{ duration: 140 }}>
            {#if page === "appearance"}
              {@render group("Colour")}
              <div class="grid grid-cols-4 gap-2.5 @max-[600px]:grid-cols-2">
                {#each Object.entries(ACCENTS) as [id, a] (id)}
                  {@const active = s.accent === id}
                  <button
                    class={[
                      "group flex items-center gap-3 rounded-xl border p-3 text-left transition-all",
                      active ? "border-accent/60 bg-accent-soft" : "border-line-soft bg-surface-1 hover:border-line hover:bg-surface-2",
                    ]}
                    onclick={() => (s.accent = id as keyof typeof ACCENTS)}
                  >
                    <span
                      class="flex size-7 shrink-0 items-center justify-center rounded-full"
                      style:background="radial-gradient(circle at 35% 30%, oklch(0.88 0.12 {a.hue}), oklch(0.62 0.25 {a.hue}) 55%, oklch(0.35 0.16 {a.hue}))"
                      style:box-shadow={active ? `0 0 16px oklch(0.7 0.24 ${a.hue} / 0.6)` : "none"}
                    >
                      {#if active}<Check size={14} strokeWidth={3} class="text-white" />{/if}
                    </span>
                    <span class={["text-[13px] font-medium", active ? "text-fg" : "text-fg-muted"]}>{a.label}</span>
                  </button>
                {/each}
              </div>

              {@render group("Surface")}
              {#snippet glassCtl()}
                <Segmented
                  bind:value={s.glass}
                  options={[
                    { value: "frosted", label: "Frosted" },
                    { value: "clear", label: "Clear" },
                    { value: "solid", label: "Solid" },
                  ]}
                />
              {/snippet}
              {@render row("Glass", "Solid turns off blur — fastest on older machines and Linux.", glassCtl)}
              {#snippet ambientCtl()}<Switch bind:checked={s.ambient} label="Ambient background" />{/snippet}
              {@render row("Ambient glow", "Soft coloured light behind the panels.", ambientCtl)}

              {@render group("Size")}
              {#snippet densityCtl()}
                <Segmented
                  bind:value={s.density}
                  options={[
                    { value: "compact", label: "Compact" },
                    { value: "comfortable", label: "Comfortable" },
                  ]}
                />
              {/snippet}
              {@render row("Density", "Row height in the commit list.", densityCtl)}
              {#snippet scaleCtl()}
                <div class="flex items-center gap-3">
                  <input
                    type="range"
                    min="0.85"
                    max="1.25"
                    step="0.05"
                    bind:value={s.scale}
                    class="w-44 accent-[var(--color-accent)]"
                    aria-label="Interface size"
                  />
                  <span class="w-11 text-right text-[13px] text-fg-muted tabular-nums">{Math.round(s.scale * 100)}%</span>
                </div>
              {/snippet}
              {@render row("Interface size", "Scales the whole interface.", scaleCtl)}
            {:else if page === "typography"}
              {@render group("Title font")}
              <div class="grid grid-cols-3 gap-2.5 @max-[640px]:grid-cols-2">
                {#each Object.entries(TITLE_FONTS) as [id, f] (id)}
                  {@const active = s.titleFont === id}
                  <button
                    class={[
                      "relative overflow-hidden rounded-xl border p-4 text-left transition-all",
                      active ? "border-accent/60 bg-accent-soft" : "border-line-soft bg-surface-1 hover:border-line hover:bg-surface-2",
                    ]}
                    onclick={() => (s.titleFont = id as keyof typeof TITLE_FONTS)}
                  >
                    {#if active}
                      <span class="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-accent-strong">
                        <Check size={12} strokeWidth={3} class="text-white" />
                      </span>
                    {/if}
                    <div
                      class="bg-gradient-to-b from-white via-white to-accent bg-clip-text text-[34px] leading-[1.1] text-transparent"
                      style:font-family={f.family}
                      style:font-weight={f.weight}
                      style:font-variation-settings={f.variation}
                      style:letter-spacing={f.tracking}
                    >
                      Orbe
                    </div>
                    <div class="mt-2.5 text-[13.5px] font-medium text-fg">{f.label}</div>
                    <div class="mt-0.5 text-[12px] text-fg-faint">{f.note}</div>
                  </button>
                {/each}
              </div>

              {@render group("Interface font")}
              <div class="grid grid-cols-2 gap-2.5 @max-[480px]:grid-cols-1">
                {#each Object.entries(UI_FONTS) as [id, f] (id)}
                  {@const active = s.uiFont === id}
                  <button
                    class={[
                      "relative rounded-xl border p-4 text-left transition-all",
                      active ? "border-accent/60 bg-accent-soft" : "border-line-soft bg-surface-1 hover:border-line hover:bg-surface-2",
                    ]}
                    style:font-family={f.family}
                    onclick={() => (s.uiFont = id as keyof typeof UI_FONTS)}
                  >
                    {#if active}
                      <span class="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-accent-strong">
                        <Check size={12} strokeWidth={3} class="text-white" />
                      </span>
                    {/if}
                    <div class="text-[22px] leading-none font-semibold text-fg">Aa</div>
                    <div class="mt-3 text-[14px] font-medium text-fg">{f.label}</div>
                    <div class="mt-0.5 text-[12.5px] text-fg-faint">{f.note}</div>
                    <div class="mt-3 truncate text-[13px] text-fg-muted">Merge branch 'feature/orbit' into main</div>
                  </button>
                {/each}
              </div>

              {@render group("Code font")}
              <div class="grid grid-cols-3 gap-2.5 @max-[600px]:grid-cols-1">
                {#each Object.entries(MONO_FONTS) as [id, f] (id)}
                  {@const active = s.monoFont === id}
                  <button
                    class={[
                      "rounded-xl border p-4 text-left transition-all",
                      active ? "border-accent/60 bg-accent-soft" : "border-line-soft bg-surface-1 hover:border-line hover:bg-surface-2",
                    ]}
                    onclick={() => (s.monoFont = id as keyof typeof MONO_FONTS)}
                  >
                    <div class="text-[13.5px] font-medium text-fg">{f.label}</div>
                    <div class="mt-2 text-[12.5px] leading-relaxed" style:font-family={f.family}>
                      <span class="text-deleted">- const a = 1;</span><br />
                      <span class="text-added">+ const a = 0x2A;</span>
                    </div>
                  </button>
                {/each}
              </div>
            {:else if page === "layout"}
              <!-- Live mini-map of the layout -->
              <div class="mb-6 flex justify-center">
                <div class={["glass-well flex h-[132px] w-[280px] gap-1.5 rounded-xl p-2", s.sidebarSide === "right" && "flex-row-reverse"]}>
                  <div class="w-[64px] rounded-md bg-surface-3"></div>
                  <div class={["flex flex-1 gap-1.5", s.detailsPosition === "right" ? "flex-row" : "flex-col"]}>
                    <div class="flex flex-1 flex-col gap-1 rounded-md bg-surface-2 p-1.5">
                      {#each Array(4) as _, i}
                        <div class="h-1.5 rounded-full bg-surface-4" style:width="{90 - i * 14}%"></div>
                      {/each}
                    </div>
                    <div class="flex-1 rounded-md border border-accent/40 bg-accent-soft"></div>
                  </div>
                </div>
              </div>

              {#snippet sideCtl()}
                <Segmented
                  bind:value={s.sidebarSide}
                  options={[
                    { value: "left", label: "Left", icon: PanelLeft },
                    { value: "right", label: "Right", icon: PanelRight },
                  ]}
                />
              {/snippet}
              {@render row("Sidebar position", "Which side the branch sidebar sits on.", sideCtl)}
              {#snippet modeCtl()}
                <Segmented
                  bind:value={s.sidebarMode}
                  options={[
                    { value: "auto", label: "Auto" },
                    { value: "open", label: "Full" },
                    { value: "icons", label: "Icons" },
                  ]}
                />
              {/snippet}
              {#snippet sizesCtl()}
                <button class="btn h-8 px-3" onclick={() => (s.sizes = { ...DEFAULT_SIZES })}><RotateCcw size={13} /> Reset sizes</button>
              {/snippet}
              {@render row("Panel sizes", "Drag the edge between any two panels to resize them. Double-click an edge to reset it.", sizesCtl)}
              {@render row("Sidebar size", "Auto shows icons only when the window is narrow. Toggle any time with Ctrl+\\ (⌘\\ on Mac).", modeCtl)}
              {#snippet detailsCtl()}
                <Segmented
                  bind:value={s.detailsPosition}
                  options={[
                    { value: "bottom", label: "Below", icon: Rows2 },
                    { value: "right", label: "Beside", icon: Columns2 },
                  ]}
                />
              {/snippet}
              {@render row("Commit details", "Show the selected commit below or beside the history.", detailsCtl)}
              {#snippet avatarsCtl()}<Switch bind:checked={s.showAvatars} label="Show avatars" />{/snippet}
              {@render row("Author avatars", "Coloured initials next to author names.", avatarsCtl)}
              {#snippet datesCtl()}<Switch bind:checked={s.relativeDates} label="Relative dates" />{/snippet}
              {@render row("Relative dates", "“2 days ago” instead of the calendar date.", datesCtl)}
            {:else if page === "arrange"}
              <p class="mb-5 rounded-xl border border-line-soft bg-surface-1 px-4 py-3 text-[13px] text-fg-muted">
                Drag the rows to change the order. Use the switches to hide what you don't need. Changes apply instantly.
              </p>
              <div class="grid grid-cols-1 gap-x-8 gap-y-2 @min-[680px]:grid-cols-2">
                <div>
                  {@render group("Sidebar sections")}
                  <SortableList bind:items={s.sidebarSections} labels={SECTION_LABELS} />
                </div>
                <div>
                  {@render group("Toolbar")}
                  <SortableList bind:items={s.toolbar} labels={TOOLBAR_LABELS} />
                </div>
                <div>
                  {@render group("History columns")}
                  <SortableList bind:items={s.columns} labels={COLUMN_LABELS} />
                </div>
              </div>
            {:else if page === "ai"}
              <AiSettings />
            {/if}
          </div>
        {/key}
      </div>
    </section>
  </div>
</div>

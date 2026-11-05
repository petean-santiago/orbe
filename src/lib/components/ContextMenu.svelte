<script lang="ts">
  import { scale } from "svelte/transition";
  import { ui, type MenuItem } from "../ui.svelte";

  const menu = $derived(ui.menu!);
  let el: HTMLDivElement | undefined = $state();
  let pos = $state({ x: 0, y: 0 });
  let active = $state(-1);

  type Action = Extract<MenuItem, { run: () => void }>;
  const isAction = (i: MenuItem): i is Action => "run" in i;
  const actionable = $derived(menu.items.map((item, i) => ({ item, i })).filter(({ item }) => isAction(item) && !item.disabled));

  // Keep the menu inside the window.
  $effect(() => {
    if (!el) return;
    const { innerWidth: w, innerHeight: h } = window;
    const r = el.getBoundingClientRect();
    pos = {
      x: Math.max(8, Math.min(menu.x, w - r.width - 8)),
      y: menu.y + r.height > h - 8 ? Math.max(8, menu.y - r.height) : menu.y,
    };
    el.focus();
  });

  function run(item: MenuItem) {
    if (!isAction(item) || item.disabled) return;
    ui.closeMenu();
    item.run();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      ui.closeMenu();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const idx = actionable.findIndex((a) => a.i === active);
      const n = actionable.length;
      const next = e.key === "ArrowDown" ? (idx + 1) % n : (idx - 1 + n) % n;
      active = actionable[next]?.i ?? -1;
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      run(menu.items[active]);
    }
  }

  function onOutside(e: PointerEvent) {
    if (el && !el.contains(e.target as Node)) ui.closeMenu();
  }
</script>

<svelte:window onpointerdown={onOutside} onblur={() => ui.closeMenu()} onresize={() => ui.closeMenu()} />

<div
  bind:this={el}
  role="menu"
  tabindex="-1"
  class="glass-strong fixed z-[60] min-w-[220px] rounded-xl p-1.5 outline-none"
  style:left="{pos.x}px"
  style:top="{pos.y}px"
  style:min-width={menu.minWidth ? `${Math.max(220, menu.minWidth)}px` : undefined}
  transition:scale={{ start: 0.96, duration: 110 }}
  onkeydown={onKey}
  oncontextmenu={(e) => e.preventDefault()}
>
  {#each menu.items as item, i}
    {#if "separator" in item}
      <div class="mx-2 my-1 h-px bg-line-soft"></div>
    {:else if "header" in item}
      <div class="truncate px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.04em] text-fg-faint">{item.header}</div>
    {:else}
      <button
        role="menuitem"
        disabled={item.disabled}
        class={[
          "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors duration-75 disabled:opacity-40",
          item.danger
            ? i === active
              ? "bg-deleted/15 text-deleted"
              : "text-deleted/90 hover:bg-deleted/15"
            : i === active
              ? "bg-accent-soft text-fg"
              : "text-fg-muted hover:bg-surface-3 hover:text-fg",
        ]}
        onmouseenter={() => (active = i)}
        onclick={() => run(item)}
      >
        {#if item.icon}
          <item.icon size={14} class={item.danger ? "" : i === active ? "text-accent" : "text-fg-faint"} />
        {:else}
          <span class="w-3.5"></span>
        {/if}
        <span class="min-w-0 flex-1 truncate">{item.label}</span>
        {#if item.hint}<span class="text-[11px] text-fg-faint">{item.hint}</span>{/if}
      </button>
    {/if}
  {/each}
</div>

<script lang="ts">
  import { LoaderCircle, Plus, Settings, X } from "@lucide/svelte";
  import { app, GROUP_COLORS, type RepoTab, type TabGroup } from "../state.svelte";
  import { isMac, modKey } from "../format";
  import { groupLabel, groupMenu, tabMenu } from "../tabGroups";
  import { fade, slide } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import Logo from "./Logo.svelte";
  import Sortable from "./Sortable.svelte";
  import WindowControls from "./WindowControls.svelte";

  /** The tab strip as a list of loose tabs and whole groups, each draggable as one piece. */
  type Segment = { key: string; tab: RepoTab } | { key: string; group: TabGroup; tabs: RepoTab[] };

  const segments = $derived.by(() => {
    const out: Segment[] = [];
    const byGroup = new Map<string, RepoTab[]>();
    for (const tab of app.tabs) {
      const group = app.groupOf(tab);
      if (!group) {
        out.push({ key: `t${tab.id}`, tab });
        continue;
      }
      const list = byGroup.get(group.id);
      if (list) list.push(tab);
      else {
        const tabs = [tab];
        byGroup.set(group.id, tabs);
        out.push({ key: `g${group.id}`, group, tabs });
      }
    }
    return out;
  });

  /** Only the group holding the focused tab is unfolded; the rest fold into stacks. */
  const isOpen = (s: Segment) => "group" in s && s.tabs.some((t) => t.id === app.activeId);

  const flatten = (segs: Segment[]) => segs.flatMap((s) => ("tab" in s ? [s.tab] : s.tabs));

  function reorderGroup(group: TabGroup, tabs: RepoTab[]) {
    app.reorderTabs(flatten(segments.map((s) => ("group" in s && s.group.id === group.id ? { ...s, tabs } : s))));
  }

  // ---- dragging tabs into and out of groups --------------------------------

  /** Group the dragged tab is hovering (it joins on release), and a tab being pulled out of its group. */
  let dropGroup = $state<string | null>(null);
  let leaving = $state<number | null>(null);

  function groupAt(x: number, y: number): string | null {
    for (const el of document.querySelectorAll<HTMLElement>("[data-group-id]")) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top - 12 && y <= r.bottom + 12) return el.dataset.groupId!;
    }
    return null;
  }

  const centerX = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2;
  };

  /** Position among a group's tabs for a drop at `x`. */
  function indexInGroup(groupId: string, x: number, dragged: RepoTab) {
    const el = document.querySelector(`[data-group-id="${groupId}"]`);
    const tabs = el ? [...el.querySelectorAll<HTMLElement>("[data-tab-id]")] : [];
    // A folded group shows no tabs: add at the end.
    if (!tabs.length) return undefined;
    return tabs.filter(
      (t) => Number(t.dataset.tabId) !== dragged.id && centerX(t) < x,
    ).length;
  }

  /** Position in the whole strip for a drop at `x` (the dragged tab excluded). */
  function indexInStrip(x: number, dragged: RepoTab) {
    let n = 0;
    for (const s of segments) {
      const el = document.querySelector("tab" in s ? `[data-tab-id="${s.tab.id}"]` : `[data-group-id="${s.group.id}"]`);
      if (!el || centerX(el) >= x) break;
      n += "tab" in s ? (s.tab === dragged ? 0 : 1) : s.tabs.filter((t) => t !== dragged).length;
    }
    return n;
  }

  /** A loose tab hovering a group joins it on release. Groups don't nest. */
  function onStripMove(seg: Segment, e: PointerEvent) {
    dropGroup = "tab" in seg ? groupAt(e.clientX, e.clientY) : null;
    return !!dropGroup;
  }

  function onStripDrop(seg: Segment, e: PointerEvent) {
    const target = dropGroup;
    dropGroup = null;
    if (e.type !== "pointerup" || !target || !("tab" in seg)) return false;
    app.addToGroup(seg.tab, target, indexInGroup(target, e.clientX, seg.tab));
    return true;
  }

  /** A grouped tab dragged outside its group leaves it, or moves to the group it's over. */
  function onGroupMove(own: TabGroup, tab: RepoTab, e: PointerEvent) {
    const over = groupAt(e.clientX, e.clientY);
    if (over === own.id) {
      dropGroup = leaving = null;
      return false;
    }
    dropGroup = over;
    leaving = tab.id;
    return true;
  }

  function onGroupDrop(tab: RepoTab, e: PointerEvent) {
    const target = dropGroup;
    const out = leaving === tab.id;
    dropGroup = leaving = null;
    if (e.type !== "pointerup" || !out) return false;
    if (target) app.addToGroup(tab, target, indexInGroup(target, e.clientX, tab));
    else app.removeFromGroup(tab, indexInStrip(e.clientX, tab));
    return true;
  }

  function onAux(e: MouseEvent, tab: RepoTab) {
    // Middle-click closes a tab, like in a browser.
    if (e.button === 1) {
      e.preventDefault();
      app.closeTab(tab.id);
    }
  }

  const tint = (color: string, pct: number) => `color-mix(in oklch, ${color} ${pct}%, transparent)`;
</script>

{#snippet tabView(tab: RepoTab, dragging: boolean, color: string | null)}
  {@const active = tab.id === app.activeId}
  {@const changes = tab.status.length}
  <div
    role="tab"
    tabindex="0"
    aria-selected={active}
    title={[app.groupOf(tab)?.name, tab.repo?.path ?? "New tab"].filter(Boolean).join(" · ")}
    data-tab-id={tab.id}
    onclick={() => app.activate(tab.id)}
    onkeydown={(e) => e.key === "Enter" && app.activate(tab.id)}
    onauxclick={(e) => onAux(e, tab)}
    oncontextmenu={(e) => tabMenu(e, tab)}
    class={[
      "group relative flex h-8 w-full min-w-0 items-center gap-2 rounded-lg pr-1 pl-3 text-[13px] transition-colors duration-150",
      active ? "glass text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      dragging && "glass-strong shadow-2xl",
      leaving === tab.id && "opacity-80 outline-1 outline-offset-2 outline-dashed outline-fg-faint",
    ]}
  >
    {#if active}
      <span
        class="absolute inset-x-3 -bottom-px h-px bg-gradient-to-r from-transparent via-accent to-transparent"
        style:--color-accent={color ?? undefined}
      ></span>
    {/if}
    {#if tab.loading || tab.remoteOp}
      <LoaderCircle size={13} class="shrink-0 animate-spin" style="color: {color ?? 'var(--color-accent)'}" />
    {:else}
      {@const dot = color ?? "var(--color-accent)"}
      <span
        class={["size-2 shrink-0 rounded-full", !tab.repo ? "border border-fg-faint" : !active && !color && "bg-fg-faint/60"]}
        style:background={tab.repo && (active || color) ? (active ? dot : tint(color!, 65)) : undefined}
        style:box-shadow={tab.repo && active ? `0 0 8px ${dot}` : undefined}
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

<header
  data-tauri-drag-region
  class={["relative flex h-11 shrink-0 items-center gap-2 pr-0", isMac ? "pl-[80px]" : "pl-3"]}
>
  <div data-tauri-drag-region class="flex shrink-0 items-center pr-1">
    <Logo size={24} />
  </div>

  <div class="flex min-w-0 items-center gap-1">
    <Sortable
      items={segments}
      key={(s) => s.key}
      onreorder={(segs) => app.reorderTabs(flatten(segs))}
      ondragmove={onStripMove}
      ondrop={onStripDrop}
      axis="x"
      class="min-w-0 items-center gap-1"
      itemClass={(s) => ("tab" in s ? "min-w-0 w-[200px] shrink" : isOpen(s) ? "min-w-0 shrink" : "shrink-0")}
    >
      {#snippet children(seg, { dragging })}
        {#if "tab" in seg}
          {@render tabView(seg.tab, dragging, null)}
        {:else}
          {@const g = seg.group}
          {@const color = GROUP_COLORS[g.color]}
          {@const open = isOpen(seg)}
          {@const target = dropGroup === g.id}
          <div
            role="group"
            aria-label={groupLabel(g)}
            data-group-id={g.id}
            class={["relative flex h-8 min-w-0 items-center rounded-lg transition-[background-color,box-shadow] duration-200", open && "mx-1"]}
            style:background={target ? tint(color, 14) : undefined}
            style:box-shadow={target ? `inset 0 0 0 1.5px ${tint(color, 70)}` : undefined}
          >
            {#if open}
              <!-- Unfolded: the group's name leads its tabs; a thread in its colour ties them together. -->
              <button
                class="flex h-8 max-w-[150px] shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] font-semibold tracking-[-0.005em] transition-colors hover:bg-surface-2"
                style:color
                title="{groupLabel(g)}: group options"
                onclick={(e) => groupMenu(e, g)}
                oncontextmenu={(e) => groupMenu(e, g)}
              >
                <span class="truncate">{groupLabel(g)}</span>
              </button>
              <div class="flex min-w-0" in:slide={{ axis: "x", duration: 220, easing: cubicOut }}>
                <Sortable
                  items={seg.tabs}
                  key={(t) => t.id}
                  onreorder={(tabs) => reorderGroup(g, tabs)}
                  ondragmove={(tab, e) => onGroupMove(g, tab, e)}
                  ondrop={onGroupDrop}
                  axis="x"
                  class="min-w-0 gap-1"
                  itemClass="min-w-0 w-[184px] shrink"
                >
                  {#snippet children(tab, { dragging: tabDragging })}
                    {@render tabView(tab, tabDragging, color)}
                  {/snippet}
                </Sortable>
              </div>
              <span
                class="pointer-events-none absolute right-2 -bottom-[5px] left-2 h-[2px] rounded-full"
                style:background="linear-gradient(90deg, {color}, {tint(color, 45)} 60%, {tint(color, 0)})"
                in:fade={{ duration: 200 }}
              ></span>
            {:else}
              <!-- Folded: a little stack of cards. Click to unfold at the tab you used last. -->
              {@const n = seg.tabs.length}
              {@const changes = seg.tabs.reduce((sum, t) => sum + t.status.length, 0)}
              {@const busy = seg.tabs.some((t) => t.loading || t.remoteOp)}
              <div class="stack-wrap group/stack relative flex" style:--c={color}>
                {#if n > 2}<span class="stack-card stack-card-3" aria-hidden="true"></span>{/if}
                {#if n > 1}<span class="stack-card stack-card-2" aria-hidden="true"></span>{/if}
                <button
                  class={["stack relative flex h-7 items-center gap-2 rounded-[9px] pr-2 pl-2.5 text-[12.5px]", dragging && "shadow-2xl"]}
                  title="{groupLabel(g)} · {n} repositor{n === 1 ? 'y' : 'ies'}. Click to open ({modKey} ↑/↓), right-click for options"
                  onclick={() => app.focusGroup(g.id)}
                  oncontextmenu={(e) => groupMenu(e, g)}
                >
                  {#if busy}
                    <LoaderCircle size={11} class="shrink-0 animate-spin" style="color: {color}" />
                  {:else}
                    <span class="size-1.5 shrink-0 rounded-full" style:background={color}></span>
                  {/if}
                  <span class="max-w-[140px] truncate font-medium text-fg-muted transition-colors group-hover/stack:text-fg">{groupLabel(g)}</span>
                  <span class="rounded-full px-1.5 text-[10.5px] leading-4 font-semibold tabular-nums" style:color style:background={tint(color, 16)}>
                    {n}
                  </span>
                  {#if changes > 0}
                    <span class="size-1.5 shrink-0 rounded-full bg-modified" title="{changes} uncommitted change{changes === 1 ? '' : 's'}"></span>
                  {/if}
                </button>
              </div>
            {/if}
          </div>
        {/if}
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

<style>
  /* A folded group: the button is the top card; one or two cards peek out behind it. */
  .stack {
    background: linear-gradient(to bottom, color-mix(in oklch, var(--c) 15%, oklch(0.165 0.02 300)), color-mix(in oklch, var(--c) 9%, oklch(0.135 0.02 300)));
    box-shadow:
      inset 0 0 0 1px color-mix(in oklch, var(--c) 32%, transparent),
      inset 0 1px 0 oklch(1 0 0 / 0.06),
      0 2px 6px -2px oklch(0 0 0 / 0.6);
    transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .stack-card {
    position: absolute;
    top: 0;
    height: 100%;
    border-radius: 9px;
    pointer-events: none;
    transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .stack-card-2 {
    inset-inline: 4px;
    transform: translateY(-3px);
    background: color-mix(in oklch, var(--c) 26%, oklch(0.17 0.02 300));
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--c) 45%, transparent);
  }
  .stack-card-3 {
    inset-inline: 9px;
    transform: translateY(-6px);
    background: color-mix(in oklch, var(--c) 16%, oklch(0.15 0.02 300));
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--c) 28%, transparent);
  }
  /* Hovering lifts the stack and fans the cards out, hinting there's more inside. */
  .stack-wrap:hover .stack {
    transform: translateY(-1px);
  }
  .stack-wrap:hover .stack-card-2 {
    transform: translateY(-5px);
  }
  .stack-wrap:hover .stack-card-3 {
    transform: translateY(-9px);
  }
</style>

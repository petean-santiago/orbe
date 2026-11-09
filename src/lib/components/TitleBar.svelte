<script lang="ts">
  import { LoaderCircle, Plus, Settings, X } from "@lucide/svelte";
  import { app, GROUP_COLORS, type RepoTab, type TabGroup } from "../state.svelte";
  import { isMac, modKey } from "../format";
  import { groupLabel, groupMenu, tabMenu } from "../tabGroups";
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
    if (!el) return undefined;
    return [...el.querySelectorAll<HTMLElement>("[data-tab-id]")].filter(
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
      active ? (color ? "text-fg" : "glass text-fg") : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      dragging && "glass-strong shadow-2xl",
      leaving === tab.id && "opacity-80 outline-1 outline-offset-2 outline-dashed outline-fg-faint",
    ]}
    style:background={active && color && !dragging ? `linear-gradient(to bottom, ${tint(color, 30)}, ${tint(color, 18)})` : undefined}
    style:box-shadow={active && color && !dragging ? `inset 0 0 0 1px ${tint(color, 55)}, 0 4px 14px -6px ${tint(color, 60)}` : undefined}
  >
    {#if active}
      <span
        class="absolute inset-x-3 -bottom-px h-px bg-gradient-to-r from-transparent via-accent to-transparent"
        style:--color-accent={color ?? undefined}
      ></span>
    {/if}
    {#if tab.loading || tab.remoteOp}
      <LoaderCircle size={13} class="shrink-0 animate-spin text-accent" />
    {:else}
      {@const dot = color ?? "var(--color-accent)"}
      <span
        class={["size-2 shrink-0 rounded-full", tab.repo ? (!active && !color && "bg-fg-faint/60") : "border border-fg-faint"]}
        style:background={tab.repo && (active || color) ? (active ? dot : tint(color!, 70)) : undefined}
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
      class="min-w-0 items-center gap-1.5"
      itemClass={(s) => ("tab" in s ? "min-w-0 w-[200px] shrink" : "min-w-0 shrink")}
    >
      {#snippet children(seg, { dragging })}
        {#if "tab" in seg}
          {@render tabView(seg.tab, dragging, null)}
        {:else}
          {@const color = GROUP_COLORS[seg.group.color]}
          {@const collapsed = seg.group.collapsed}
          {@const hasActive = seg.tabs.some((t) => t.id === app.activeId)}
          {@const target = dropGroup === seg.group.id}
          <div
            role="group"
            aria-label={groupLabel(seg.group)}
            data-group-id={seg.group.id}
            class="relative flex h-[38px] min-w-0 items-center gap-1 rounded-[11px] px-[3px] transition-[background-color,box-shadow] duration-150"
            style:background={tint(color, target ? 18 : hasActive ? 9 : 5)}
            style:box-shadow={target
              ? `inset 0 0 0 1.5px ${tint(color, 75)}, 0 0 18px -4px ${tint(color, 60)}`
              : `inset 0 0 0 1px ${tint(color, hasActive ? 38 : 20)}`}
          >
            <!-- The group's name; filled in its colour while you're inside it. -->
            <button
              class={[
                "flex h-6 max-w-[150px] shrink-0 items-center gap-1.5 rounded-[7px] px-2 text-[12px] font-semibold transition-[filter,box-shadow,background-color,color] duration-150 hover:brightness-115",
                dragging && "shadow-2xl",
              ]}
              style:color={hasActive ? "oklch(0.18 0.03 300)" : color}
              style:background={hasActive ? color : tint(color, collapsed ? 24 : 18)}
              style:box-shadow={hasActive ? `0 0 12px -2px ${tint(color, 70)}` : `inset 0 0 0 1px ${tint(color, 32)}`}
              title="{groupLabel(seg.group)} — click to {collapsed ? 'expand' : 'collapse'}, right-click for options"
              aria-expanded={!collapsed}
              onclick={() => app.toggleGroup(seg.group.id)}
              oncontextmenu={(e) => groupMenu(e, seg.group)}
            >
              {#if seg.group.name}
                <span class="truncate">{seg.group.name}</span>
              {:else}
                <span class="size-2 rounded-full" style:background={color}></span>
              {/if}
              {#if collapsed}
                <span class="rounded-full px-1 text-[10.5px] leading-4 tabular-nums" style:background={tint(color, 24)}>
                  {seg.tabs.length}
                </span>
              {/if}
            </button>

            {#if !collapsed}
              <Sortable
                items={seg.tabs}
                key={(t) => t.id}
                onreorder={(tabs) => reorderGroup(seg.group, tabs)}
                ondragmove={(tab, e) => onGroupMove(seg.group, tab, e)}
                ondrop={onGroupDrop}
                axis="x"
                class="min-w-0 gap-1"
                itemClass="min-w-0 w-[200px] shrink"
              >
                {#snippet children(tab, { dragging: tabDragging })}
                  {@render tabView(tab, tabDragging, color)}
                {/snippet}
              </Sortable>
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

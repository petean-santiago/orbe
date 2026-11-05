<script lang="ts" generics="T extends string">
  /** A settings list whose rows can be dragged to reorder and toggled on/off. */
  import { GripVertical } from "@lucide/svelte";
  import { LOCKED, type Toggleable } from "../settings.svelte";
  import Sortable from "./Sortable.svelte";
  import Switch from "./Switch.svelte";

  let {
    items = $bindable(),
    labels,
  }: { items: Toggleable<T>[]; labels: Record<T, string> } = $props();
</script>

<Sortable {items} key={(i) => i.id} onreorder={(next) => (items = next)} class="gap-1.5">
  {#snippet children(item, { dragging })}
    <div
      class={[
        "flex h-11 cursor-grab items-center gap-3 rounded-xl border px-3 transition-[background-color,box-shadow,border-color] duration-150 active:cursor-grabbing",
        dragging
          ? "glass-strong border-accent/50 shadow-[0_18px_40px_-12px_oklch(0_0_0/0.8),0_0_0_1px_var(--color-accent-soft)]"
          : "border-line-soft bg-surface-1 hover:border-line hover:bg-surface-2",
      ]}
    >
      <GripVertical size={15} class={dragging ? "text-accent" : "text-fg-faint"} />
      <span class={["flex-1 text-[13.5px] font-medium", item.visible ? "text-fg" : "text-fg-faint line-through decoration-fg-faint/40"]}>
        {labels[item.id]}
      </span>
      {#if LOCKED.has(item.id)}
        <span class="text-[11.5px] text-fg-faint">Always shown</span>
      {/if}
      <Switch
        checked={item.visible}
        disabled={LOCKED.has(item.id)}
        label="Show {labels[item.id]}"
        onchange={(v) => (items = items.map((i) => (i.id === item.id ? { ...i, visible: v } : i)))}
      />
    </div>
  {/snippet}
</Sortable>

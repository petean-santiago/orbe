<script lang="ts" generics="T extends string">
  import type { Component } from "svelte";

  let {
    value = $bindable(),
    options,
    onchange,
  }: {
    value: T;
    options: { value: T; label: string; icon?: Component<any> }[];
    /** Called with the new value (for values that aren't bound directly). */
    onchange?: (value: T) => void;
  } = $props();
</script>

<div class="glass-well inline-flex gap-0.5 rounded-lg p-0.5" role="radiogroup">
  {#each options as opt (opt.value)}
    {@const active = opt.value === value}
    <button
      role="radio"
      aria-checked={active}
      onclick={() => {
        value = opt.value;
        onchange?.(opt.value);
      }}
      class={[
        "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-all duration-150",
        active ? "bg-surface-4 text-fg shadow-[inset_0_1px_0_oklch(1_0_0/0.08)]" : "text-fg-faint hover:text-fg-muted",
      ]}
    >
      {#if opt.icon}<opt.icon size={14} />{/if}
      {opt.label}
    </button>
  {/each}
</div>

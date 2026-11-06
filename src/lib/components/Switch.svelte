<script lang="ts">
  let {
    checked = $bindable(false),
    disabled = false,
    label,
    onchange,
  }: { checked?: boolean; disabled?: boolean; label: string; onchange?: (v: boolean) => void } = $props();
</script>

<!--
  No border: the outline is an inset shadow, and the knob is centred by flexbox
  with equal padding, so it stays perfectly centred at any interface scale
  (a 1px border gets rounded unevenly on fractional display scaling). Sizes are in
  px, not Tailwind spacing units: those scale with the 13px root font size.
-->
<button
  data-no-drag
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  onclick={() => {
    checked = !checked;
    onchange?.(checked);
  }}
  class={[
    "switch inline-flex h-[24px] w-[44px] shrink-0 items-center rounded-full p-[3px] transition-[background-color,box-shadow] duration-200 disabled:opacity-40",
    checked ? "is-on bg-accent-strong" : "bg-surface-3",
  ]}
>
  <span
    class="block size-[18px] rounded-full bg-white shadow-[0_1px_3px_oklch(0_0_0/0.45)] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
    style:transform={checked ? "translateX(20px)" : "translateX(0)"}
  ></span>
</button>

<style>
  .switch {
    box-shadow: inset 0 0 0 1px var(--color-line);
  }
  .switch.is-on {
    box-shadow:
      inset 0 0 0 1px oklch(0.75 0.2 var(--accent-h) / 0.6),
      0 0 14px -2px var(--color-accent-glow);
  }
</style>

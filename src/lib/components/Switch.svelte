<script lang="ts">
  let {
    checked = $bindable(false),
    disabled = false,
    label,
    onchange,
  }: { checked?: boolean; disabled?: boolean; label: string; onchange?: (v: boolean) => void } = $props();
</script>

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
    "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors duration-200 disabled:opacity-40",
    checked ? "border-accent/60 bg-accent-strong shadow-[0_0_14px_-2px_var(--color-accent-glow)]" : "border-line bg-surface-3",
  ]}
>
  <span
    class="absolute top-[2px] left-[2px] size-4 rounded-full bg-white shadow-[0_1px_3px_oklch(0_0_0/0.4)] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
    style:transform={checked ? "translateX(16px)" : "none"}
  ></span>
</button>

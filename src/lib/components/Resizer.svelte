<script lang="ts">
  /**
   * Drag handle that resizes the panel next to it (in pixels).
   *
   * It takes no layout space: the hit area straddles the edge between the two
   * panels. Which way "grows" is worked out from where the panel sits on
   * screen, so it also works when the layout is mirrored (sidebar on the right).
   * Double-click restores the default size; arrow keys nudge it.
   */
  let {
    value = $bindable(),
    min,
    max,
    initial,
    panel = "prev",
    label = "Resize",
    class: className = "",
  }: {
    value: number;
    min: number;
    max: number;
    /** Size restored on double-click. */
    initial: number;
    /** Which DOM sibling is the panel being resized. */
    panel?: "prev" | "next";
    label?: string;
    class?: string;
  } = $props();

  let el: HTMLDivElement | undefined = $state();
  let dragging = $state(false);

  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));

  function target(): HTMLElement | null {
    return (panel === "prev" ? el?.previousElementSibling : el?.nextElementSibling) as HTMLElement | null;
  }

  /** +1 when dragging right grows the panel, -1 when dragging left does. */
  function direction(): 1 | -1 {
    const t = target()?.getBoundingClientRect();
    const h = el?.getBoundingClientRect();
    return t && h && t.left > h.left ? -1 : 1;
  }

  let lastDown = 0;

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    // preventDefault suppresses the native dblclick, so detect it here.
    const now = performance.now();
    if (now - lastDown < 350) {
      lastDown = 0;
      value = initial;
      return;
    }
    lastDown = now;
    const dir = direction();
    // Start from the rendered width: the stored value may be capped on small windows.
    const start = target()?.getBoundingClientRect().width ?? value;
    const x0 = e.clientX;
    dragging = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const move = (ev: PointerEvent) => (value = clamp(start + (ev.clientX - x0) * dir));
    const up = () => {
      dragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = (e.shiftKey ? 48 : 16) * direction() * (e.key === "ArrowRight" ? 1 : -1);
    value = clamp(value + step);
  }
</script>

<div bind:this={el} class={["relative z-20 w-0 shrink-0 self-stretch", className]}>
  <!-- A focusable separator with a value is the ARIA pattern for a resize handle. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    role="separator"
    aria-orientation="vertical"
    aria-label={label}
    aria-valuenow={value}
    aria-valuemin={min}
    aria-valuemax={max}
    tabindex="0"
    title="Drag to resize · double-click to reset"
    class="group absolute inset-y-0 -left-[5px] w-[10px] cursor-col-resize outline-none"
    onpointerdown={onPointerDown}
    onkeydown={onKey}
  >
    <div
      class={[
        "absolute inset-y-3 left-1/2 w-[3px] -translate-x-1/2 rounded-full transition-[background-color,opacity] duration-150",
        dragging ? "bg-accent/80 shadow-[0_0_10px_var(--color-accent)]" : "bg-transparent group-hover:bg-accent/40 group-focus-visible:bg-accent/60",
      ]}
    ></div>
  </div>
</div>

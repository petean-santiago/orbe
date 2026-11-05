<script lang="ts">
  /** Draggable divider. `value` is a fraction (0–1) of the parent's size. */
  let {
    value = $bindable(0.5),
    direction = "vertical",
    min = 0.2,
    max = 0.8,
  }: { value?: number; direction?: "vertical" | "horizontal"; min?: number; max?: number } = $props();

  let el: HTMLDivElement | undefined = $state();
  let dragging = $state(false);

  function onPointerDown(e: PointerEvent) {
    const parent = el?.parentElement;
    if (!parent) return;
    dragging = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = parent.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const f =
        direction === "vertical"
          ? (ev.clientY - rect.top) / rect.height
          : (ev.clientX - rect.left) / rect.width;
      value = Math.min(max, Math.max(min, f));
    };
    const up = () => {
      dragging = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
</script>

<div
  bind:this={el}
  role="separator"
  aria-orientation={direction === "vertical" ? "horizontal" : "vertical"}
  onpointerdown={onPointerDown}
  class={[
    "group relative z-10 shrink-0",
    direction === "vertical" ? "h-px cursor-row-resize bg-line-soft" : "w-px cursor-col-resize bg-line-soft",
  ]}
>
  <div
    class={[
      "absolute transition-colors duration-150",
      direction === "vertical" ? "inset-x-0 -top-1 -bottom-1" : "inset-y-0 -left-1 -right-1",
      dragging ? "bg-accent/50" : "group-hover:bg-accent/30",
    ]}
  ></div>
</div>

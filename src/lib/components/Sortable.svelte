<script lang="ts" generics="T">
  /**
   * Pointer-driven drag-and-drop reordering.
   *
   * We deliberately avoid the HTML5 drag API: Tauri intercepts native drag
   * events on Windows for file drops, and pointer events also let us animate
   * neighbours smoothly as the dragged item moves.
   *
   * A drag only starts after the pointer moves a few pixels, so plain clicks
   * on the items keep working. Put `data-no-drag` on controls (buttons,
   * switches) that should never start a drag.
   */
  import type { Snippet } from "svelte";

  let {
    items,
    key,
    onreorder,
    axis = "y",
    class: className = "",
    itemClass = "",
    children,
  }: {
    items: T[];
    key: (item: T) => string | number;
    onreorder: (items: T[]) => void;
    axis?: "x" | "y";
    class?: string;
    itemClass?: string;
    children: Snippet<[T, { dragging: boolean }]>;
  } = $props();

  const THRESHOLD = 4;

  let els: HTMLElement[] = $state([]);
  let dragIndex = $state<number | null>(null);
  let overIndex = $state(0);
  let offset = $state(0);
  let settling = $state(false);

  let rects: DOMRect[] = [];
  let step = 0;

  const pos = (e: PointerEvent) => (axis === "y" ? e.clientY : e.clientX);
  const start = (r: DOMRect) => (axis === "y" ? r.top : r.left);
  const size = (r: DOMRect) => (axis === "y" ? r.height : r.width);

  function onPointerDown(e: PointerEvent, index: number) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    const origin = pos(e);
    let started = false;

    const move = (ev: PointerEvent) => {
      const delta = pos(ev) - origin;
      if (!started) {
        if (Math.abs(delta) < THRESHOLD) return;
        started = true;
        rects = els.slice(0, items.length).map((el) => el.getBoundingClientRect());
        const r = rects[index];
        const next = rects[index + 1] ?? rects[index - 1];
        // Distance between consecutive items (size + gap).
        step = next ? Math.abs(start(next) - start(r)) : size(r);
        dragIndex = index;
        overIndex = index;
        document.body.style.cursor = "grabbing";
      }
      offset = delta;
      const center = start(rects[index]) + size(rects[index]) / 2 + delta;
      let target = index;
      for (let j = index + 1; j < rects.length; j++) {
        if (center > start(rects[j]) + size(rects[j]) / 2) target = j;
      }
      for (let j = index - 1; j >= 0; j--) {
        if (center < start(rects[j]) + size(rects[j]) / 2) target = j;
      }
      overIndex = target;
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
      if (!started) return;
      const from = index;
      const to = overIndex;
      settling = true;
      dragIndex = null;
      offset = 0;
      if (from !== to) {
        const next = items.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        onreorder(next);
      }
      // Re-enable transitions after the DOM has been reordered.
      requestAnimationFrame(() => requestAnimationFrame(() => (settling = false)));
      // Swallow the click that immediately follows a drag (but only that one).
      const swallow = (ce: Event) => {
        ce.stopPropagation();
        ce.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function shift(i: number): number {
    if (dragIndex === null) return 0;
    if (i === dragIndex) return offset;
    if (dragIndex < i && i <= overIndex) return -step;
    if (overIndex <= i && i < dragIndex) return step;
    return 0;
  }
</script>

<div class={["relative", axis === "x" ? "flex" : "flex flex-col", className]}>
  {#each items as item, i (key(item))}
    {@const d = shift(i)}
    {@const isDragging = dragIndex === i}
    <div
      bind:this={els[i]}
      role="listitem"
      class={[itemClass, isDragging && "relative z-20"]}
      style:transform={d ? (axis === "y" ? `translateY(${d}px)` : `translateX(${d}px)`) : undefined}
      style:transition={isDragging || settling ? "none" : "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)"}
      onpointerdown={(e) => onPointerDown(e, i)}
    >
      {@render children(item, { dragging: isDragging })}
    </div>
  {/each}
</div>

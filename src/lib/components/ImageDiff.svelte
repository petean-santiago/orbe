<script lang="ts">
  /**
   * Image diff with four ways to compare: side by side, a swipe divider, onion
   * skin (cross-fade) and "difference", where unchanged pixels go black and
   * only what changed lights up.
   */
  import { Blend, Columns2, Layers, LoaderCircle, SplitSquareHorizontal } from "@lucide/svelte";
  import { formatBytes } from "../format";
  import Segmented from "./Segmented.svelte";

  type Loader = (() => Promise<string>) | null;
  let { path, before, after }: { path: string; before: Loader; after: Loader } = $props();

  interface Side {
    url: string | null;
    bytes: number;
    w: number;
    h: number;
    error: string | null;
    loading: boolean;
  }

  const MIME: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
    ico: "image/x-icon", avif: "image/avif", svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff",
  };
  const mime = $derived(MIME[path.split(".").pop()!.toLowerCase()] ?? "application/octet-stream");

  const empty = (): Side => ({ url: null, bytes: 0, w: 0, h: 0, error: null, loading: false });
  let a = $state<Side>(empty());
  let b = $state<Side>(empty());

  type Mode = "side" | "swipe" | "onion" | "difference";
  let mode = $state<Mode>("side");
  let swipe = $state(50);
  let onion = $state(50);

  function load(loader: Loader, target: (s: Side) => void) {
    if (!loader) {
      target(empty());
      return () => {};
    }
    let cancelled = false;
    let url: string | null = null;
    target({ ...empty(), loading: true });
    loader()
      .then((b64) => {
        if (cancelled) return;
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        const img = new Image();
        img.onload = () => !cancelled && target({ url, bytes: bytes.length, w: img.naturalWidth, h: img.naturalHeight, error: null, loading: false });
        img.onerror = () => !cancelled && target({ ...empty(), error: "Couldn't decode this image." });
        img.src = url;
      })
      .catch((e) => !cancelled && target({ ...empty(), error: String(e) }));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }

  $effect(() => load(before, (s) => (a = s)));
  $effect(() => load(after, (s) => (b = s)));

  const both = $derived(!!a.url && !!b.url);
  const sameSize = $derived(a.w === b.w && a.h === b.h);
  /** One box both images fit in, so overlays line up. */
  const box = $derived({ w: Math.max(a.w, b.w) || 1, h: Math.max(a.h, b.h) || 1 });
  /** Small images are shown up to 2× (max 480px) so details are visible; large ones fit the space. */
  const display = (w: number) => Math.max(w, Math.min(w * 2, 480));
  const delta = $derived(a.bytes && b.bytes ? Math.round(((b.bytes - a.bytes) / a.bytes) * 100) : 0);

  function dragSwipe(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const set = (x: number) => (swipe = Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100)));
    set(e.clientX);
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => set(ev.clientX);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }
</script>

{#snippet frame(side: Side, label: string, tone: "del" | "add")}
  <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
    <div class="flex items-center gap-2 text-[12px]">
      <span class={["rounded-md px-1.5 py-0.5 font-semibold", tone === "del" ? "bg-deleted/15 text-deleted" : "bg-added/15 text-added"]}>{label}</span>
      {#if side.url}<span class="text-fg-faint tabular-nums">{side.w} × {side.h} · {formatBytes(side.bytes)}</span>{/if}
    </div>
    <div class="checker flex min-h-0 flex-1 items-center justify-center rounded-xl p-4">
      {#if side.loading}
        <LoaderCircle size={18} class="animate-spin text-fg-faint" />
      {:else if side.error}
        <span class="text-center text-[12.5px] text-fg-faint">{side.error}</span>
      {:else if side.url}
        <img
          src={side.url}
          alt={label}
          class="max-h-full max-w-full object-contain"
          style:width="{display(side.w)}px"
          style:image-rendering={side.w <= 64 ? "pixelated" : undefined}
        />
      {/if}
    </div>
  </div>
{/snippet}

<div class="flex h-full min-h-0 flex-col bg-black/25">
  <!-- Toolbar -->
  <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line-soft px-4 py-2 text-[12px]">
    {#if both}
      <Segmented
        bind:value={mode}
        options={[
          { value: "side", label: "Side by side", icon: Columns2 },
          { value: "swipe", label: "Swipe", icon: SplitSquareHorizontal },
          { value: "onion", label: "Onion skin", icon: Layers },
          { value: "difference", label: "Difference", icon: Blend },
        ]}
      />
      {#if mode === "onion"}
        <label class="flex items-center gap-2 text-fg-faint">
          Before
          <input type="range" min="0" max="100" bind:value={onion} class="w-32 accent-[var(--color-accent)]" aria-label="Blend" />
          After
        </label>
      {/if}
      <span class="flex-1"></span>
      <span class="text-fg-faint tabular-nums">
        {#if !sameSize}{a.w}×{a.h} → {b.w}×{b.h} ·{/if}
        {formatBytes(a.bytes)} → {formatBytes(b.bytes)}
        {#if delta}<span class={delta > 0 ? "text-deleted" : "text-added"}> ({delta > 0 ? "+" : ""}{delta}%)</span>{/if}
      </span>
    {:else}
      <span class="text-fg-faint">{before ? "This image was deleted." : "This image is new."}</span>
    {/if}
  </div>

  <div class="flex min-h-0 flex-1 p-4">
    {#if !before || !after}
      {@render frame(before ? a : b, before ? "Deleted" : "Added", before ? "del" : "add")}
    {:else if mode === "side" || !both}
      <div class="flex min-h-0 flex-1 gap-4">
        {@render frame(a, "Before", "del")}
        {@render frame(b, "After", "add")}
      </div>
    {:else}
      <div class="checker flex min-h-0 flex-1 items-center justify-center rounded-xl p-4">
        <!-- A box with the larger image's proportions; both images fill it identically. -->
        <div class="relative max-h-full max-w-full" style:aspect-ratio="{box.w} / {box.h}" style:width="min(100%, {display(box.w)}px)">
          {#if mode === "swipe"}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="absolute inset-0 cursor-ew-resize touch-none" onpointerdown={dragSwipe}>
              <img src={b.url} alt="After" class="absolute inset-0 h-full w-full object-contain" />
              <img src={a.url} alt="Before" class="absolute inset-0 h-full w-full object-contain" style:clip-path="inset(0 {100 - swipe}% 0 0)" />
              <div class="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_10px_rgb(0_0_0/0.6)]" style:left="{swipe}%">
                <span class="absolute top-1/2 left-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[11px] font-bold text-black shadow-lg">⇆</span>
              </div>
              <span class="pointer-events-none absolute top-2 left-2 rounded-md bg-deleted/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">Before</span>
              <span class="pointer-events-none absolute top-2 right-2 rounded-md bg-added/80 px-1.5 py-0.5 text-[11px] font-semibold text-black">After</span>
            </div>
          {:else if mode === "onion"}
            <img src={a.url} alt="Before" class="absolute inset-0 h-full w-full object-contain" />
            <img src={b.url} alt="After" class="absolute inset-0 h-full w-full object-contain" style:opacity={onion / 100} />
          {:else}
            <div class="absolute inset-0 bg-black"></div>
            <img src={a.url} alt="Before" class="absolute inset-0 h-full w-full object-contain" />
            <img src={b.url} alt="After" class="absolute inset-0 h-full w-full object-contain mix-blend-difference" />
          {/if}
        </div>
      </div>
    {/if}
  </div>
  {#if mode === "difference" && both}
    <p class="shrink-0 px-4 pb-3 text-[12px] text-fg-faint">Unchanged pixels are black; anything that changed lights up.</p>
  {/if}
</div>

<style>
  .checker {
    background-color: oklch(0.13 0.01 300);
    background-image:
      linear-gradient(45deg, oklch(0.17 0.01 300) 25%, transparent 25%),
      linear-gradient(-45deg, oklch(0.17 0.01 300) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, oklch(0.17 0.01 300) 75%),
      linear-gradient(-45deg, transparent 75%, oklch(0.17 0.01 300) 75%);
    background-size: 18px 18px;
    background-position: 0 0, 0 9px, 9px -9px, -9px 0;
  }
</style>

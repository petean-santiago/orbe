<script lang="ts">
  /** Image preview: fit or actual size, on a checkerboard so transparency shows. */
  import { LoaderCircle, Maximize, Minimize } from "@lucide/svelte";
  import { git } from "../api";
  import { app } from "../state.svelte";
  import { formatBytes } from "../format";

  let { path, svgText = null, size = 0 }: { path: string; svgText?: string | null; size?: number } = $props();

  const MIME: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif", apng: "image/apng", svg: "image/svg+xml",
    tif: "image/tiff", tiff: "image/tiff",
  };
  const ext = $derived(path.split(".").pop()!.toLowerCase());

  let url = $state<string | null>(null);
  let error = $state<string | null>(null);
  let actual = $state(false);
  let dims = $state<{ w: number; h: number } | null>(null);

  $effect(() => {
    const repo = app.repo;
    const text = svgText;
    if (!repo) return;
    let cancelled = false;
    let made: string | null = null;
    (async () => {
      try {
        let blob: Blob;
        if (text !== null) {
          blob = new Blob([text], { type: "image/svg+xml" });
        } else {
          const b64 = await git.readFileBase64(repo.path, path);
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          blob = new Blob([bytes], { type: MIME[ext] ?? "application/octet-stream" });
        }
        if (cancelled) return;
        made = URL.createObjectURL(blob);
        url = made;
      } catch (e) {
        if (!cancelled) error = String(e);
      }
    })();
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  });
</script>

<div class="flex h-full flex-col">
  <div class="checker relative min-h-0 flex-1 overflow-auto">
    {#if error}
      <div class="flex h-full items-center justify-center px-8 text-center text-[13px] text-fg-faint">{error}</div>
    {:else if !url}
      <div class="flex h-full items-center justify-center"><LoaderCircle size={20} class="animate-spin text-fg-faint" /></div>
    {:else}
      <div class={["flex min-h-full min-w-full p-6", actual ? "w-max items-start justify-start" : "items-center justify-center"]}>
        <button class={["block", actual ? "cursor-zoom-out" : "cursor-zoom-in"]} onclick={() => (actual = !actual)} title={actual ? "Fit to view" : "Actual size"}>
          <img
            src={url}
            alt={path}
            draggable="false"
            onload={(e) => {
              const img = e.currentTarget as HTMLImageElement;
              dims = { w: img.naturalWidth, h: img.naturalHeight };
            }}
            class={["block rounded-md shadow-[0_12px_40px_-12px_rgb(0_0_0/0.8)]", !actual && "max-h-[calc(100vh-260px)] max-w-full object-contain"]}
            style:image-rendering={dims && dims.w <= 64 ? "pixelated" : undefined}
            style:min-width={dims && dims.w <= 64 && !actual ? "128px" : undefined}
          />
        </button>
      </div>
    {/if}
  </div>
  <div class="flex h-9 shrink-0 items-center gap-3 border-t border-line-soft px-4 text-[12px] text-fg-faint tabular-nums">
    {#if dims}<span>{dims.w} × {dims.h}px</span>{/if}
    {#if size}<span>{formatBytes(size)}</span>{/if}
    <span class="font-mono uppercase">{ext}</span>
    <span class="flex-1"></span>
    <button class="flex items-center gap-1.5 rounded-md px-2 py-0.5 transition-colors hover:bg-surface-2 hover:text-fg-muted" onclick={() => (actual = !actual)}>
      {#if actual}<Minimize size={13} /> Fit{:else}<Maximize size={13} /> Actual size{/if}
    </button>
  </div>
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

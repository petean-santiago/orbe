<script lang="ts">
  /** A coloured folder that visibly opens and closes, with an emblem for special folders. */
  import { folderStyle, hueColor } from "../fileIcons";

  let { name, open = false, size = 16 }: { name: string; open?: boolean; size?: number } = $props();

  const style = $derived(folderStyle(name));
  const color = $derived(hueColor(style.hue, 0.76, 0.14));
</script>

<span class="relative inline-flex shrink-0" style:width="{size}px" style:height="{size}px">
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
    {#if open}
      <!-- back of the folder -->
      <path d="M4 20a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" fill={color} fill-opacity="0.16" />
      <!-- front flap, tilted open -->
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2" fill={color} fill-opacity="0.34" />
    {:else}
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" fill={color} fill-opacity="0.24" />
    {/if}
  </svg>
  {#if style.emblem}
    <span
      class="absolute -right-[3px] -bottom-[3px] flex items-center justify-center rounded-full bg-[oklch(0.12_0.015_320)]"
      style:width="{Math.round(size * 0.62)}px"
      style:height="{Math.round(size * 0.62)}px"
    >
      <style.emblem size={Math.round(size * 0.5)} strokeWidth={2.6} color={color} />
    </span>
  {/if}
</span>

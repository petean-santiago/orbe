<script lang="ts">
  /** File icon coloured by language / file type. */
  import { fileStyle, hueColor } from "../fileIcons";

  let { path, size = 14 }: { path: string; size?: number } = $props();

  const style = $derived(fileStyle(path));
</script>

<style.icon {size} strokeWidth={1.9} color={hueColor(style.hue)} class="shrink-0" />

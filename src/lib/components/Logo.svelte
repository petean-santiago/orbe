<script lang="ts">
  import mark from "../../assets/orbe-mark.svg";

  let { size = 28, glow = false }: { size?: number; glow?: boolean } = $props();
</script>

<img
  src={mark}
  alt="Orbe"
  width={size}
  height={size * 0.66}
  draggable="false"
  class="pointer-events-none shrink-0 select-none"
  style:filter={glow ? "drop-shadow(0 0 24px oklch(0.7 0.25 328 / 0.55))" : undefined}
/>

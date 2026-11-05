<script lang="ts">
  import { avatarHue, initials } from "../format";

  let { name, email = "", size = 22 }: { name: string; email?: string; size?: number } = $props();
  const hue = $derived(avatarHue(email || name));
</script>

<span
  class="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white/95"
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{Math.round(size * 0.42)}px"
  style:background="linear-gradient(135deg, oklch(0.62 0.17 {hue}), oklch(0.45 0.16 {hue + 40}))"
  style:box-shadow="0 0 0 1px oklch(1 0 0 / 0.08) inset"
  title={email ? `${name} <${email}>` : name}
>
  {initials(name)}
</span>

<script lang="ts">
  import type { FileStatus } from "../api";
  import { STATUS_META } from "../format";

  let { status }: { status: FileStatus } = $props();
  const meta = $derived(STATUS_META[status]);
</script>

<span
  class="inline-flex size-[18px] shrink-0 items-center justify-center rounded-xs font-mono text-[10px] font-bold"
  style:color={meta.color}
  style:background="color-mix(in oklch, {meta.color} 16%, transparent)"
  title={meta.label}
>
  {meta.letter}
</span>

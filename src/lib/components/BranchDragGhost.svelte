<script lang="ts">
  /** The chip that follows the pointer while a branch is dragged. */
  import { ArrowRight, Cloud, GitBranch, GitMerge } from "@lucide/svelte";
  import { branchDrag } from "../branchDrag.svelte";

  const source = $derived(branchDrag.source!);
  const target = $derived(branchDrag.target);
</script>

<div
  class="pointer-events-none fixed z-[70] flex flex-col items-start gap-1"
  style:left="{branchDrag.x + 14}px"
  style:top="{branchDrag.y + 12}px"
>
  <div class="glass-strong flex items-center gap-2 rounded-full py-1 pr-3 pl-2 text-[12.5px] font-medium text-fg shadow-[0_12px_30px_-8px_rgb(0_0_0/0.8)]">
    <span class="flex size-5 items-center justify-center rounded-full bg-accent-strong text-white">
      {#if source.kind === "remote"}<Cloud size={11} strokeWidth={2.5} />{:else}<GitBranch size={11} strokeWidth={2.5} />{/if}
    </span>
    {source.name}
  </div>
  <div
    class={[
      "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] transition-colors",
      target ? "bg-accent-strong text-white" : "bg-black/60 text-fg-faint",
    ]}
  >
    {#if target}
      <GitMerge size={11} strokeWidth={2.5} /> into <ArrowRight size={11} /> <span class="font-semibold">{target.name}</span>
    {:else}
      Drop on a branch to merge
    {/if}
  </div>
</div>

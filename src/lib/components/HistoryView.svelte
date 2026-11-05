<script lang="ts">
  import { app } from "../state.svelte";
  import { settings } from "../settings.svelte";
  import CommitDetails from "./CommitDetails.svelte";
  import CommitList from "./CommitList.svelte";
  import Splitter from "./Splitter.svelte";

  let splitBottom = $state(0.5);
  let splitRight = $state(0.58);

  const side = $derived(settings.value.detailsPosition === "right");
</script>

<div class={["flex h-full min-h-0", side ? "flex-row" : "flex-col"]}>
  <div class="min-h-0 min-w-0" style:flex="0 0 {(side ? splitRight : splitBottom) * 100}%">
    <CommitList />
  </div>
  {#if side}
    <Splitter bind:value={splitRight} direction="horizontal" min={0.35} max={0.78} />
  {:else}
    <Splitter bind:value={splitBottom} min={0.2} max={0.8} />
  {/if}
  <div class="min-h-0 min-w-0 flex-1 bg-black/20">
    {#if app.selectedCommit}
      {#key app.selectedCommit.hash}
        <CommitDetails commit={app.selectedCommit} stacked={side} />
      {/key}
    {:else}
      <div class="flex h-full items-center justify-center text-[13px] text-fg-faint">Select a commit</div>
    {/if}
  </div>
</div>

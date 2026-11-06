<script lang="ts">
  import { app } from "../state.svelte";
  import { settings } from "../settings.svelte";
  import CommitDetails from "./CommitDetails.svelte";
  import CommitList from "./CommitList.svelte";
  import Splitter from "./Splitter.svelte";


  let width = $state(1200);
  // "Beside" needs room for both panes; fall back to below on narrow windows.
  const side = $derived(settings.value.detailsPosition === "right" && width >= 1000);

  const close = () => (app.selectedHash = null);
</script>

<div class={["flex h-full min-h-0", side ? "flex-row" : "flex-col"]} bind:clientWidth={width}>
  <!-- The list stays mounted (keeping its scroll position); it fills the space when details are closed. -->
  <div
    class="min-h-0 min-w-0"
    style:flex={app.selectedCommit ? `0 0 ${(side ? settings.value.sizes.historySplitSide : settings.value.sizes.historySplit) * 100}%` : "1 1 0%"}
  >
    <CommitList />
  </div>
  {#if app.selectedCommit}
    {#if side}
      <Splitter bind:value={settings.value.sizes.historySplitSide} direction="horizontal" min={0.35} max={0.78} />
    {:else}
      <Splitter bind:value={settings.value.sizes.historySplit} min={0.2} max={0.8} />
    {/if}
    <div class="min-h-0 min-w-0 flex-1 bg-black/20">
      {#key app.selectedCommit.hash}
        <CommitDetails commit={app.selectedCommit} stacked={side} onclose={close} />
      {/key}
    </div>
  {/if}
</div>

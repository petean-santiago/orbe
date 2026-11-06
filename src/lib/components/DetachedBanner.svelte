<script lang="ts">
  /**
   * Shown while HEAD points at a commit instead of a branch, so it's always
   * clear you're looking at the past, with a one-click way back.
   */
  import { ArrowLeft, GitBranchPlus, History, LoaderCircle } from "@lucide/svelte";
  import { slide } from "svelte/transition";
  import { app } from "../state.svelte";
  import { newBranch } from "../actions";

  const tab = $derived(app.active);
  const commit = $derived(tab.headCommit);
  const back = $derived(
    tab.previousBranch ??
      tab.branches.find((b) => b.kind === "local" && (b.name === "main" || b.name === "master"))?.name ??
      tab.branches.find((b) => b.kind === "local")?.name ??
      null,
  );
  let busy = $state(false);

  async function goBack() {
    busy = true;
    await tab.backToBranch();
    busy = false;
  }
</script>

<div class="px-2 pb-2" transition:slide={{ duration: 180 }}>
  <div class="flex items-center gap-3 rounded-xl border border-[oklch(0.75_0.12_230/0.35)] bg-[oklch(0.7_0.12_230/0.1)] px-3.5 py-2 text-[12.5px]">
    <History size={16} class="shrink-0 text-[oklch(0.82_0.11_230)]" />
    <span class="min-w-0 flex-1 truncate text-fg-muted">
      <span class="font-semibold text-fg">Viewing an older commit</span>
      {#if commit}
        · <span class="font-mono text-[12px] text-fg">{commit.shortHash}</span> “{commit.subject}”
      {/if}
      <span class="text-fg-faint"> · commits made here won't belong to any branch</span>
    </span>
    <button class="btn h-7 shrink-0 px-2.5 text-[12px]" onclick={() => commit && newBranch({ ref: commit.hash, label: `commit ${commit.shortHash}` })}>
      <GitBranchPlus size={13} /> New branch here
    </button>
    {#if back}
      <button class="btn-primary h-7 shrink-0 px-3 text-[12px]" disabled={busy} onclick={goBack}>
        {#if busy}<LoaderCircle size={13} class="animate-spin" />{:else}<ArrowLeft size={13} />{/if}
        Back to {back}
      </button>
    {/if}
  </div>
</div>

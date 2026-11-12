<script lang="ts">
  /**
   * Shown while a merge/rebase is stopped half-way, so the user always knows
   * what state the repository is in and how to finish or back out.
   */
  import { CheckCheck, CircleAlert, CircleCheck, LoaderCircle, Sparkles } from "@lucide/svelte";
  import { slide } from "svelte/transition";
  import { confirmAction } from "../api";
  import { app } from "../state.svelte";
  import { applyAiSuggestions, readyAiFiles, resolveMergeWithAi } from "../mergeAi.svelte";
  import AiConflictHelp from "./AiConflictHelp.svelte";

  const tab = $derived(app.active);
  const op = $derived(tab.operation!);
  const conflicts = $derived(new Set(tab.status.filter((s) => s.status === "conflicted").map((s) => s.path)).size);
  let busy = $state<"continue" | "abort" | "apply" | null>(null);
  /** Files the AI resolved completely, ready to save in one go. */
  const ready = $derived(readyAiFiles(tab).length);

  async function applyAll() {
    busy = "apply";
    await applyAiSuggestions(tab);
    busy = null;
  }

  const NAMES = { merge: "Merge", rebase: "Rebase", "cherry-pick": "Cherry-pick", revert: "Revert" } as const;

  async function run(kind: "continue" | "abort") {
    if (kind === "abort") {
      const ok = await confirmAction(`Abort the ${op}? Your branch goes back to how it was before it started.`, `Abort ${op}`, "Abort");
      if (!ok) return;
    }
    busy = kind;
    await (kind === "continue" ? tab.continueOperation() : tab.abortOperation());
    busy = null;
  }
</script>

<div class="px-2 pb-2" transition:slide={{ duration: 180 }}>
  <div
    class={[
      "flex items-center gap-3 rounded-xl border px-3.5 py-2 text-[12.5px]",
      conflicts ? "border-modified/35 bg-modified/10" : "border-added/30 bg-added/10",
    ]}
  >
    {#if conflicts}
      <CircleAlert size={16} class="shrink-0 text-modified" />
      <span class="min-w-0 flex-1 text-fg-muted">
        <span class="font-semibold text-fg">{NAMES[op]} in progress</span> ·
        {conflicts} conflicted file{conflicts === 1 ? "" : "s"}. Resolve {conflicts === 1 ? "it" : "them"} in Changes, then continue.
      </span>
    {:else}
      <CircleCheck size={16} class="shrink-0 text-added" />
      <span class="min-w-0 flex-1 text-fg-muted">
        <span class="font-semibold text-fg">{NAMES[op]} in progress</span> · no conflicts left. Continue to finish it.
      </span>
    {/if}
    {#if conflicts}
      {@const progress = tab.aiResolving}
      <div class="flex shrink-0">
        <button
          class="btn h-7 rounded-r-none border-accent/40 bg-accent-soft px-2.5 text-[12px] text-fg hover:border-accent/70"
          disabled={!!busy || !!progress}
          title="Let AI resolve the conflicts in every file; you review each one before it's saved"
          onclick={() => resolveMergeWithAi(tab)}
        >
          {#if progress}
            <LoaderCircle size={12} class="animate-spin" /> Resolving {Math.min(progress.done + 1, progress.total)} of {progress.total}…
          {:else}
            <Sparkles size={12} class="text-accent" /> Resolve all with AI
          {/if}
        </button>
        <AiConflictHelp compact class="btn h-7 rounded-l-none border-l-0 border-accent/40 bg-accent-soft px-1.5 hover:border-accent/70" />
      </div>
      {#if ready && !progress}
        <button
          class="btn-primary h-7 shrink-0 px-3 text-[12px]"
          disabled={!!busy}
          title="Save every file the AI resolved completely and mark it resolved"
          onclick={applyAll}
        >
          {#if busy === "apply"}<LoaderCircle size={12} class="animate-spin" />{:else}<CheckCheck size={13} />{/if}
          Apply AI to {ready} file{ready === 1 ? "" : "s"}
        </button>
      {/if}
    {/if}
    {#if conflicts && tab.view !== "changes"}
      <button class="btn h-7 px-2.5 text-[12px]" onclick={() => (tab.view = "changes")}>Resolve conflicts</button>
    {/if}
    <button class="btn h-7 px-2.5 text-[12px]" disabled={!!busy} onclick={() => run("abort")}>
      {#if busy === "abort"}<LoaderCircle size={12} class="animate-spin" />{/if} Abort
    </button>
    <button class="btn-primary h-7 px-3 text-[12px]" disabled={!!busy || conflicts > 0} onclick={() => run("continue")}>
      {#if busy === "continue"}<LoaderCircle size={12} class="animate-spin" />{/if} Continue
    </button>
  </div>
</div>

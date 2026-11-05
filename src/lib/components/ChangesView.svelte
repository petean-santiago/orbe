<script lang="ts">
  import { Check, Minus, Plus, Sparkles, Undo2 } from "@lucide/svelte";
  import { confirmAction, git, type FileChange } from "../api";
  import { app } from "../state.svelte";
  import { modKey } from "../format";
  import DiffView from "./DiffView.svelte";
  import FileList from "./FileList.svelte";

  // Drafts live on the tab so switching tabs never loses a half-written message.
  const tab = $derived(app.active);
  let amend = $state(false);
  let committing = $state(false);

  let diff = $state<string | null>(null);
  let loadingDiff = $state(false);

  const canCommit = $derived(tab.draftSummary.trim().length > 0 && (app.staged.length > 0 || amend) && !committing);

  // Auto-select the first change so the diff pane is never empty when there is work.
  $effect(() => {
    if (!app.selectedChange && app.status.length) app.selectedChange = app.unstaged[0] ?? app.staged[0];
  });

  $effect(() => {
    const repo = app.repo;
    const f = app.selectedChange;
    // Re-run when the status list refreshes, so the diff stays current.
    void app.status;
    if (!repo || !f) {
      diff = null;
      return;
    }
    let cancelled = false;
    loadingDiff = true;
    git
      .fileDiff(repo.path, f.path, f.staged, f.status === "untracked")
      .then((d) => !cancelled && (diff = d))
      .catch((e) => !cancelled && (diff = String(e)))
      .finally(() => !cancelled && (loadingDiff = false));
    return () => (cancelled = true);
  });

  async function discard(files: FileChange[]) {
    const label = files.length === 1 ? files[0].path : `${files.length} files`;
    const ok = await confirmAction(
      `Discard all changes to ${label}? This cannot be undone.`,
      "Discard changes",
      "Discard",
    );
    if (ok) await app.discard(files);
  }

  async function submit() {
    if (!canCommit) return;
    committing = true;
    const summary = tab.draftSummary.trim();
    const description = tab.draftDescription.trim();
    const message = description ? `${summary}\n\n${description}` : summary;
    const ok = await app.commit(message, amend);
    committing = false;
    if (ok) amend = false;
  }

  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  const select = (f: FileChange) => (app.selectedChange = f);
</script>

{#snippet header(label: string, count: number, action: string, onaction: () => void, extra?: () => void)}
  <div class="flex h-9 shrink-0 items-center gap-2 px-3">
    <span class="section-label flex-1 px-0">{label}</span>
    <span class="rounded-full bg-surface-3 px-1.5 text-[11px] leading-[18px] font-semibold text-fg-muted tabular-nums">{count}</span>
    {#if extra && count > 0}
      <button class="icon-btn size-6" title="Discard all" onclick={extra}><Undo2 size={13} /></button>
    {/if}
    <button class="btn h-6 px-2 text-[12px]" disabled={count === 0} onclick={onaction}>{action}</button>
  </div>
{/snippet}

<div class="flex h-full min-h-0">
  <div class="flex w-[380px] shrink-0 flex-col border-r border-line-soft bg-black/15">
    {#if app.status.length === 0}
      <div class="flex flex-1 animate-fade-in flex-col items-center justify-center gap-3 px-8 text-center">
        <div class="relative flex size-14 items-center justify-center rounded-2xl border border-accent/20 bg-accent-soft text-accent shadow-[0_0_40px_-8px_var(--color-accent-glow)]">
          <Sparkles size={22} />
        </div>
        <div>
          <p class="text-[13.5px] font-semibold text-fg">Working tree clean</p>
          <p class="mt-1 text-[12px] text-fg-faint">Nothing to commit. Go make something beautiful.</p>
        </div>
      </div>
    {:else}
      <div class="flex min-h-0 flex-1 flex-col">
        {@render header("Unstaged", app.unstaged.length, "Stage all", () => app.stage(app.unstaged), () => discard(app.unstaged))}
        <div class="min-h-0 flex-1 overflow-y-auto">
          <FileList files={app.unstaged} selected={app.selectedChange} onselect={select} onactivate={(f) => app.stage([f])}>
            {#snippet actions(f)}
              <button class="icon-btn size-6" title="Discard changes" onclick={(e) => (e.stopPropagation(), discard([f]))}>
                <Undo2 size={13} />
              </button>
              <button class="icon-btn size-6 hover:text-added" title="Stage" onclick={(e) => (e.stopPropagation(), app.stage([f]))}>
                <Plus size={14} />
              </button>
            {/snippet}
          </FileList>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col border-t border-line-soft">
        {@render header("Staged", app.staged.length, "Unstage all", () => app.unstage(app.staged))}
        <div class="min-h-0 flex-1 overflow-y-auto">
          {#if app.staged.length === 0}
            <p class="px-4 py-2 text-[12px] text-fg-faint">Double-click an unstaged file to stage it.</p>
          {/if}
          <FileList files={app.staged} selected={app.selectedChange} onselect={select} onactivate={(f) => app.unstage([f])}>
            {#snippet actions(f)}
              <button class="icon-btn size-6 hover:text-deleted" title="Unstage" onclick={(e) => (e.stopPropagation(), app.unstage([f]))}>
                <Minus size={14} />
              </button>
            {/snippet}
          </FileList>
        </div>
      </div>
    {/if}

    <!-- Commit composer -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="shrink-0 border-t border-line-soft bg-black/20 p-3" onkeydown={onKey}>
      <div class="glass-well overflow-hidden rounded-xl transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_var(--color-accent-soft)]">
        <input
          bind:value={tab.draftSummary}
          placeholder="Summary (required)"
          maxlength="200"
          class="h-9 w-full bg-transparent px-3 text-[13px] font-medium text-fg outline-none placeholder:text-fg-faint"
        />
        <div class="mx-3 h-px bg-line-soft"></div>
        <textarea
          bind:value={tab.draftDescription}
          placeholder="Description"
          rows="3"
          class="block w-full resize-none bg-transparent px-3 py-2 text-[13px] text-fg-muted outline-none placeholder:text-fg-faint"
        ></textarea>
      </div>
      <div class="mt-2.5 flex items-center gap-2">
        <label class="flex items-center gap-2 text-[12px] text-fg-muted">
          <span class={["flex size-4 items-center justify-center rounded-xs border transition-colors", amend ? "border-accent bg-accent-strong" : "border-line bg-surface-2"]}>
            {#if amend}<Check size={11} strokeWidth={3} class="text-white" />{/if}
          </span>
          <input type="checkbox" bind:checked={amend} class="sr-only" />
          Amend
        </label>
        <span class="flex-1"></span>
        <span class="text-[11px] text-fg-faint">{modKey} ↵</span>
        <button class="btn-primary" disabled={!canCommit} onclick={submit}>
          {committing ? "Committing…" : `Commit${app.staged.length ? ` ${app.staged.length} file${app.staged.length > 1 ? "s" : ""}` : ""}`}
        </button>
      </div>
    </div>
  </div>

  <div class="min-w-0 flex-1">
    <DiffView {diff} loading={loadingDiff} />
  </div>
</div>

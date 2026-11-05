<script lang="ts">
  import { Check, Copy, GitCommitHorizontal, GitMerge } from "@lucide/svelte";
  import { git, type Commit, type FileChange } from "../api";
  import { app } from "../state.svelte";
  import { fullDate, relativeTime } from "../format";
  import Avatar from "./Avatar.svelte";
  import DiffView from "./DiffView.svelte";
  import FileList from "./FileList.svelte";

  let { commit, stacked = false }: { commit: Commit; stacked?: boolean } = $props();

  let files = $state<FileChange[]>([]);
  let selected = $state<FileChange | null>(null);
  let diff = $state<string | null>(null);
  let loadingDiff = $state(false);
  let copied = $state(false);

  // Load the changed files whenever the commit changes.
  $effect(() => {
    const repo = app.repo;
    const hash = commit.hash;
    if (!repo) return;
    let cancelled = false;
    git.commitFiles(repo.path, hash).then((list) => {
      if (cancelled) return;
      files = list;
      selected = list[0] ?? null;
      if (!list.length) diff = null;
    });
    return () => (cancelled = true);
  });

  // Load the diff for the selected file.
  $effect(() => {
    const repo = app.repo;
    const file = selected;
    const hash = commit.hash;
    if (!repo || !file) return;
    let cancelled = false;
    loadingDiff = true;
    git
      .commitFileDiff(repo.path, hash, file.path, file.oldPath)
      .then((d) => !cancelled && (diff = d))
      .catch((e) => !cancelled && (diff = String(e)))
      .finally(() => !cancelled && (loadingDiff = false));
    return () => (cancelled = true);
  });

  async function copyHash() {
    await navigator.clipboard.writeText(commit.hash);
    copied = true;
    setTimeout(() => (copied = false), 1400);
  }

  const parents = $derived(
    commit.parents.map((p) => app.commits.find((c) => c.hash === p) ?? { hash: p, shortHash: p.slice(0, 7), subject: "" }),
  );
</script>

<div class={["flex h-full min-h-0", stacked && "flex-col"]}>
  <div class={["flex shrink-0 flex-col border-line-soft", stacked ? "max-h-[45%] border-b" : "w-[360px] border-r"]}>
    <div class="animate-fade-in border-b border-line-soft px-5 py-4">
      <h2 class="selectable text-[15px] leading-snug font-semibold text-fg">{commit.subject}</h2>
      <div class="mt-3 flex items-center gap-2.5">
        <Avatar name={commit.author} email={commit.email} size={28} />
        <div class="min-w-0 leading-tight">
          <div class="truncate text-[13px] font-medium text-fg">{commit.author}</div>
          <div class="truncate text-[12px] text-fg-faint" title={fullDate(commit.timestamp)}>
            {relativeTime(commit.timestamp)} · {fullDate(commit.timestamp)}
          </div>
        </div>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
        <button
          class="inline-flex h-6 items-center gap-1.5 rounded-sm border border-line bg-surface-2 px-2 font-mono text-fg-muted transition-colors hover:text-fg"
          onclick={copyHash}
          title="Copy full hash"
        >
          <GitCommitHorizontal size={12} />
          {commit.shortHash}
          {#if copied}<Check size={11} class="text-added" />{:else}<Copy size={11} class="opacity-60" />{/if}
        </button>
        {#each parents as p}
          <button
            class="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 font-mono text-fg-faint transition-colors hover:bg-surface-2 hover:text-fg-muted"
            title={p.subject ? `Parent: ${p.subject}` : "Parent"}
            onclick={() => (app.selectedHash = p.hash)}
          >
            {#if parents.length > 1}<GitMerge size={11} />{/if}
            ← {p.shortHash}
          </button>
        {/each}
      </div>
    </div>

    <div class="flex items-center justify-between px-3 pt-3 pb-1.5">
      <span class="section-label px-0">Files</span>
      <span class="text-[11px] text-fg-faint tabular-nums">{files.length}</span>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto pb-2">
      <FileList {files} {selected} onselect={(f) => (selected = f)} />
    </div>
  </div>

  <div class="min-h-0 min-w-0 flex-1">
    <DiffView diff={selected ? diff : null} loading={loadingDiff} />
  </div>
</div>

<script lang="ts">
  import { Check, Copy, GitCommitHorizontal, GitMerge, Mail, Sparkles, X } from "@lucide/svelte";
  import { explainCommit } from "../assistant.svelte";
  import { git, type Commit, type CommitPeople, type FileChange } from "../api";
  import { app } from "../state.svelte";
  import { fullDate, relativeTime } from "../format";
  import Avatar from "./Avatar.svelte";
  import DiffView from "./DiffView.svelte";
  import ImageDiff from "./ImageDiff.svelte";
  import { commitImage, isImage } from "../imageDiff";
  import FileList from "./FileList.svelte";
  import Resizer from "./Resizer.svelte";
  import { settings, DEFAULT_SIZES } from "../settings.svelte";

  let { commit, stacked = false, onclose }: { commit: Commit; stacked?: boolean; onclose?: () => void } = $props();

  /** Closing clears the selection; the history then takes all the room. */
  const close = () => (onclose ? onclose() : (app.selectedHash = null));

  let width = $state(1000);
  // Too narrow for the info column beside the diff: stack them.
  const vertical = $derived(stacked || width < 760);

  let files = $state<FileChange[]>([]);
  let selected = $state<FileChange | null>(null);
  let diff = $state<string | null>(null);
  let loadingDiff = $state(false);
  let copied = $state(false);
  let people = $state<CommitPeople | null>(null);
  /** Which email was just copied ("author" | "committer"), for the check mark. */
  let copiedEmail = $state<string | null>(null);

  // Who committed it (can differ from the author), loaded on demand.
  $effect(() => {
    const repo = app.repo;
    const hash = commit.hash;
    people = null;
    if (!repo) return;
    let cancelled = false;
    git
      .commitPeople(repo.path, hash)
      .then((p) => !cancelled && (people = p))
      .catch(() => {});
    return () => (cancelled = true);
  });

  const authorEmail = $derived(people?.authorEmail ?? commit.email);
  /** Someone else committed it (rebase, cherry-pick, web merge…). */
  const otherCommitter = $derived(
    people && (people.committer !== people.author || people.committerEmail.toLowerCase() !== people.authorEmail.toLowerCase())
      ? people
      : null,
  );

  async function copyEmail(email: string, key: string) {
    await navigator.clipboard.writeText(email);
    copiedEmail = key;
    setTimeout(() => copiedEmail === key && (copiedEmail = null), 1400);
  }

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
      .commitFileDiff(repo.path, hash, file.path, file.oldPath, settings.value.diffIgnoreWhitespace)
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

{#snippet email(value: string, key: string)}
  <button
    class="selectable group inline-flex min-w-0 items-center gap-1 truncate text-[12px] text-fg-faint transition-colors hover:text-accent-fg"
    title="Copy email"
    onclick={() => copyEmail(value, key)}
  >
    <Mail size={11} class="shrink-0 opacity-70" />
    <span class="truncate">{value}</span>
    {#if copiedEmail === key}<Check size={11} class="shrink-0 text-added" />{:else}<Copy size={10} class="shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />{/if}
  </button>
{/snippet}

<div class={["flex h-full min-h-0", vertical && "flex-col"]} bind:clientWidth={width}>
  <div
    class={["flex shrink-0 flex-col border-line-soft", vertical ? "max-h-[45%] border-b" : "border-r"]}
    style:width={vertical ? undefined : `min(${settings.value.sizes.commitInfo}px, 55%)`}
  >
    <div class="relative animate-fade-in border-b border-line-soft px-5 py-4">
      <button
        class="absolute top-3 right-3 flex size-8 items-center justify-center rounded-lg border border-line bg-surface-2 text-fg-muted transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-fg"
        title="Close details (Esc)"
        aria-label="Close details"
        onclick={close}
      >
        <X size={16} strokeWidth={2.2} />
      </button>
      <h2 class="selectable pr-10 font-display text-[17px] leading-snug text-fg">{commit.subject}</h2>
      <div class="mt-3 flex items-center gap-2.5">
        <Avatar name={commit.author} email={commit.email} size={28} />
        <div class="min-w-0 leading-tight">
          <div class="flex min-w-0 items-baseline gap-1.5">
            <span class="shrink-0 truncate text-[13px] font-medium text-fg">{commit.author}</span>
            {#if authorEmail}
              {@render email(authorEmail, "author")}
            {/if}
          </div>
          <div class="truncate text-[12px] text-fg-faint" title={fullDate(commit.timestamp)}>
            {relativeTime(commit.timestamp)} · {fullDate(commit.timestamp)}
          </div>
        </div>
      </div>
      {#if otherCommitter}
        <div class="mt-2.5 flex items-center gap-2 rounded-lg border border-line-soft bg-surface-2/60 px-2.5 py-1.5">
          <Avatar name={otherCommitter.committer} email={otherCommitter.committerEmail} size={18} />
          <div class="flex min-w-0 flex-1 items-baseline gap-1.5 text-[12px] leading-tight">
            <span class="shrink-0 text-fg-faint">Committed by</span>
            <span class="shrink-0 truncate font-medium text-fg-muted">{otherCommitter.committer}</span>
            {@render email(otherCommitter.committerEmail, "committer")}
          </div>
          <span class="shrink-0 text-[11.5px] text-fg-faint" title={fullDate(otherCommitter.committerTime)}>
            {relativeTime(otherCommitter.committerTime)}
          </span>
        </div>
      {/if}
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
        <button
          class="inline-flex h-6 items-center gap-1.5 rounded-sm border border-accent/25 bg-accent-soft px-2 text-accent-fg transition-colors hover:border-accent/50"
          title="Explain this commit with AI"
          onclick={() => explainCommit(app.active, commit)}
        >
          <Sparkles size={11} /> Explain
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

  {#if !vertical}
    <Resizer bind:value={settings.value.sizes.commitInfo} min={240} max={600} initial={DEFAULT_SIZES.commitInfo} label="Resize commit details" />
  {/if}
  <div class="min-h-0 min-w-0 flex-1">
    {#if selected && app.repo && isImage(selected.path)}
      {@const img = commitImage(app.repo.path, commit, selected)}
      {#key selected.path}
        <ImageDiff path={selected.path} before={img.before} after={img.after} />
      {/key}
    {:else}
      <DiffView diff={selected ? diff : null} path={selected?.path ?? null} loading={loadingDiff} />
    {/if}
  </div>
</div>

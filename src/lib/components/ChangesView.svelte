<script lang="ts">
  /**
   * Source control, laid out like VS Code: the message box and Commit button
   * sit at the top of the changes list, with Staged Changes and Changes below.
   */
  import {
    Check,
    ChevronDown,
    ChevronRight,
    History,
    LoaderCircle,
    Maximize2,
    Minimize2,
    Minus,
    Plus,
    Sparkles,
    Undo2,
    Upload,
    WandSparkles,
    X,
  } from "@lucide/svelte";
  import { confirmAction, git, type FileChange } from "../api";
  import { app } from "../state.svelte";
  import { ui } from "../ui.svelte";
  import { modKey } from "../format";
  import { generateCommitMessage } from "../assistant.svelte";
  import DiffView from "./DiffView.svelte";
  import ImageDiff from "./ImageDiff.svelte";
  import { isImage, worktreeImage } from "../imageDiff";
  import FileList from "./FileList.svelte";
  import Resizer from "./Resizer.svelte";
  import { settings, DEFAULT_SIZES } from "../settings.svelte";

  // The draft lives on the tab so switching tabs never loses a half-written message.
  const tab = $derived(app.active);
  let amend = $state(false);
  let committing = $state(false);
  let generating = $state(false);
  let open = $state({ staged: true, changes: true });
  let expanded = $state(false);
  const summaryLength = $derived(tab.draftMessage.split("\n")[0].trim().length);
  const bodyLines = $derived(
    tab.draftMessage
      .split("\n")
      .slice(1)
      .filter((l) => l.trim()).length,
  );
  let messageBox: HTMLTextAreaElement | undefined = $state();

  let diff = $state<string | null>(null);
  let loadingDiff = $state(false);

  /**
   * What Commit includes: the staged files, or, when nothing is staged,
   * every change (staged for you first), like VS Code's smart commit.
   */
  const commitAll = $derived(app.staged.length === 0 && app.unstaged.length > 0);
  const conflicted = $derived(app.status.some((s) => s.status === "conflicted"));
  const fileCount = $derived(commitAll ? new Set(app.unstaged.map((f) => f.path)).size : app.staged.length);
  const hasMessage = $derived(tab.draftMessage.trim().length > 0);
  const branch = $derived(app.headBranch?.name ?? app.repo?.head ?? "HEAD");
  const canCommit = $derived(hasMessage && (fileCount > 0 || amend) && !(commitAll && conflicted) && !committing);

  const commitLabel = $derived.by(() => {
    if (committing) return amend ? "Amending…" : "Committing…";
    if (amend) return fileCount ? `Amend with ${fileCount} file${fileCount === 1 ? "" : "s"}` : "Amend last commit";
    if (fileCount === 0) return "Commit";
    const files = `${fileCount} file${fileCount === 1 ? "" : "s"}`;
    return commitAll ? `Commit all ${files}` : `Commit ${files}`;
  });

  const WRITE_HINT = "write";
  /** One line telling the user what happens next. */
  const hint = $derived.by(() => {
    if (app.status.length === 0 && !amend) return null;
    if (commitAll && conflicted) return "Resolve the conflicted files, or stage only the files you want.";
    if (!hasMessage) return WRITE_HINT;
    if (commitAll) return "Nothing is staged, so all changes will be committed. Use + on a file to commit only some.";
    if (app.unstaged.length) return `Only the staged files will be committed. The other ${app.unstaged.length} stay for later.`;
    return null;
  });

  // Auto-select the first change so the diff pane is never empty when there is work.
  $effect(() => {
    if (!app.selectedChange && app.status.length) app.selectedChange = app.staged[0] ?? app.unstaged[0];
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
      .fileDiff(repo.path, f.path, f.staged, f.status === "untracked", settings.value.diffIgnoreWhitespace)
      .then((d) => !cancelled && (diff = d))
      .catch((e) => !cancelled && (diff = String(e)))
      .finally(() => !cancelled && (loadingDiff = false));
    return () => (cancelled = true);
  });

  async function discard(files: FileChange[]) {
    const label = files.length === 1 ? files[0].path : `${files.length} files`;
    const ok = await confirmAction(`Discard all changes to ${label}? This cannot be undone.`, "Discard changes", "Discard");
    if (ok) await app.discard(files);
  }

  async function commit(thenPush = false) {
    if (!canCommit) return;
    committing = true;
    // First line is the summary; keep the rest as the body.
    const [summary, ...body] = tab.draftMessage.trim().split("\n");
    const description = body.join("\n").trim();
    const message = description ? `${summary.trim()}\n\n${description}` : summary.trim();
    // Nothing staged: include everything, as the button says.
    if (commitAll) await app.stage(app.unstaged);
    const ok = await app.commit(message, amend);
    committing = false;
    if (ok) {
      amend = false;
      if (thenPush) await app.remote("push");
    }
  }

  function setAmend(on: boolean) {
    amend = on;
    // Start from the last commit's message, like `git commit --amend`.
    if (on && !hasMessage) {
      const head = app.commits.find((c) => c.refs.some((r) => r.startsWith("HEAD")));
      if (head) tab.draftMessage = head.subject;
    }
    messageBox?.focus();
  }

  function commitMenu(e: MouseEvent) {
    ui.menuBelow(e.currentTarget as HTMLElement, [
      { label: "Commit", icon: Check, hint: `${modKey}+↵`, run: () => commit(), disabled: !canCommit },
      { label: "Commit & Push", icon: Upload, run: () => commit(true), disabled: !canCommit },
      { separator: true },
      amend
        ? { label: "Stop amending", icon: X, run: () => setAmend(false) }
        : { label: "Amend last commit", icon: History, run: () => setAmend(true), disabled: app.commits.length === 0 },
      { label: "Generate message with AI", icon: WandSparkles, run: generate, disabled: app.status.length === 0 },
    ]);
  }

  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  }

  const select = (f: FileChange) => (app.selectedChange = f);

  async function generate() {
    if (generating) return;
    generating = true;
    const t = tab;
    const result = await generateCommitMessage(t);
    generating = false;
    if (result) {
      t.draftMessage = result.description ? `${result.summary}\n\n${result.description}` : result.summary;
      messageBox?.focus();
    }
  }
</script>

{#snippet section(key: "staged" | "changes", label: string, count: number, actions: import("svelte").Snippet)}
  <div class="group/section sticky top-0 z-10 flex h-8 items-center gap-1 bg-[oklch(0.1_0.012_320/0.85)] pr-2 pl-1.5 backdrop-blur-md">
    <button class="flex min-w-0 flex-1 items-center gap-1 text-left" onclick={() => (open[key] = !open[key])}>
      <ChevronRight size={13} strokeWidth={2.5} class={["shrink-0 text-fg-faint transition-transform duration-150", open[key] && "rotate-90"]} />
      <span class="section-label truncate px-0">{label}</span>
    </button>
    {@render actions()}
    <span class="ml-0.5 rounded-full bg-surface-3 px-1.5 text-[11px] leading-[18px] font-semibold text-fg-muted tabular-nums">{count}</span>
  </div>
{/snippet}

<div class="flex h-full min-h-0">
  <div class="flex shrink-0 flex-col border-r border-line-soft bg-black/15" style:width="min({settings.value.sizes.changesList}px, 60%)">
    <!-- Commit box, at the top like VS Code -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="shrink-0 border-b border-line-soft p-3" onkeydown={onKey}>
      <div
        class={[
          "glass-well relative rounded-xl transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_var(--color-accent-soft)]",
          amend && "border-modified/40",
        ]}
      >
        <textarea
          bind:this={messageBox}
          bind:value={tab.draftMessage}
          placeholder={`Summary of the change\n\nDescription (optional): what changed and why\n\n${modKey}+Enter commits on "${branch}"`}
          rows="1"
          spellcheck="true"
          class="block w-full resize-none bg-transparent pt-3 pr-11 pb-2.5 pl-3.5 text-[13.5px] leading-[1.6] text-fg outline-none [field-sizing:content] placeholder:text-fg-faint/80"
          style:min-height={expanded ? "min(46vh, 420px)" : "116px"}
          style:max-height={expanded ? "70vh" : "38vh"}
        ></textarea>
        <div class="absolute top-2 right-2 flex flex-col gap-0.5">
          <button
            class="flex size-7 items-center justify-center rounded-lg text-accent transition-colors hover:bg-accent-soft disabled:opacity-40"
            title={commitAll || !app.staged.length ? "Write the message with AI from all your changes" : "Write the message with AI from the staged changes"}
            disabled={generating || app.status.length === 0}
            onclick={generate}
          >
            {#if generating}<LoaderCircle size={15} class="animate-spin" />{:else}<WandSparkles size={15} />{/if}
          </button>
          <button
            class="flex size-7 items-center justify-center rounded-lg text-fg-faint transition-colors hover:bg-surface-3 hover:text-fg"
            title={expanded ? "Smaller message box" : "Bigger message box"}
            onclick={() => ((expanded = !expanded), messageBox?.focus())}
          >
            {#if expanded}<Minimize2 size={14} />{:else}<Maximize2 size={14} />{/if}
          </button>
        </div>
        {#if hasMessage}
          <div class="flex items-center gap-2 border-t border-line-soft px-3.5 py-1.5 text-[11.5px] text-fg-faint">
            <span class={summaryLength > 72 ? "text-modified" : ""} title="Keep the summary (first line) under 72 characters so it reads well everywhere">
              Summary {summaryLength}/72
            </span>
            {#if bodyLines}<span>· description {bodyLines} line{bodyLines === 1 ? "" : "s"}</span>{/if}
            <span class="flex-1"></span>
            <button class="hover:text-fg-muted" title="Clear the message" onclick={() => ((tab.draftMessage = ""), messageBox?.focus())}>Clear</button>
          </div>
        {/if}
      </div>

      {#if amend}
        <div class="mt-2 flex items-center gap-2 rounded-lg border border-modified/25 bg-modified/10 px-2.5 py-1.5 text-[12px] text-modified">
          <History size={13} class="shrink-0" />
          <span class="flex-1">Amending the last commit</span>
          <button class="icon-btn size-5" title="Stop amending" onclick={() => setAmend(false)}><X size={12} /></button>
        </div>
      {/if}

      <div class="mt-2 flex">
        <button
          class="btn-primary h-9 min-w-0 flex-1 justify-center rounded-r-none"
          disabled={!canCommit}
          onclick={() => commit()}
          title="Commit ({modKey}+Enter)"
        >
          {#if committing}<LoaderCircle size={15} class="animate-spin" />{:else}<Check size={15} strokeWidth={2.5} />{/if}
          <span class="truncate">{commitLabel}</span>
        </button>
        <button
          class="btn-primary h-9 w-9 shrink-0 justify-center rounded-l-none border-l border-black/25 px-0"
          title="More commit options"
          disabled={committing}
          onclick={commitMenu}
        >
          <ChevronDown size={15} />
        </button>
      </div>

      {#if hint}
        <p class="mt-2 px-0.5 text-[11.5px] leading-snug text-fg-faint">
          {#if hint === WRITE_HINT}
            Write a message, or use <WandSparkles size={12} class="-mt-0.5 inline text-accent" /> to let AI write it.
          {:else}
            {hint}
          {/if}
        </p>
      {/if}
    </div>

    <!-- Changes, under the commit box -->
    <div class="min-h-0 flex-1 overflow-y-auto pb-2">
      {#if app.status.length === 0}
        <div class="flex animate-fade-in flex-col items-center gap-3 px-8 pt-12 text-center">
          <div class="relative flex size-14 items-center justify-center rounded-2xl border border-accent/20 bg-accent-soft text-accent shadow-[0_0_40px_-8px_var(--color-accent-glow)]">
            <Sparkles size={22} />
          </div>
          <div>
            <p class="font-display text-[18px] text-fg">Working tree clean</p>
            <p class="mt-1 text-[12px] text-fg-faint">Nothing to commit. Go make something beautiful.</p>
          </div>
        </div>
      {:else}
        {#if app.staged.length}
          {#snippet stagedActions()}
            <button class="icon-btn size-6" title="Unstage all" onclick={() => app.unstage(app.staged)}><Minus size={14} /></button>
          {/snippet}
          {@render section("staged", "Staged Changes", app.staged.length, stagedActions)}
          {#if open.staged}
            <FileList files={app.staged} selected={app.selectedChange} onselect={select} onactivate={(f) => app.unstage([f])}>
              {#snippet actions(f)}
                <button class="icon-btn size-6 hover:text-deleted" title="Unstage" onclick={(e) => (e.stopPropagation(), app.unstage([f]))}>
                  <Minus size={14} />
                </button>
              {/snippet}
            </FileList>
          {/if}
        {/if}

        {#if app.unstaged.length}
          {#snippet changeActions()}
            <button class="icon-btn size-6" title="Discard all changes" onclick={() => discard(app.unstaged)}><Undo2 size={13} /></button>
            <button class="icon-btn size-6 hover:text-added" title="Stage all changes" onclick={() => app.stage(app.unstaged)}><Plus size={14} /></button>
          {/snippet}
          <div class={app.staged.length ? "mt-1" : ""}>
            {@render section("changes", "Changes", app.unstaged.length, changeActions)}
          </div>
          {#if open.changes}
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
          {/if}
        {/if}
      {/if}
    </div>
  </div>

  <Resizer bind:value={settings.value.sizes.changesList} min={240} max={720} initial={DEFAULT_SIZES.changesList} label="Resize file list" />
  <div class="min-w-0 flex-1">
    {#if app.selectedChange && app.repo && isImage(app.selectedChange.path)}
      {@const img = worktreeImage(app.repo.path, app.selectedChange)}
      {#key app.selectedChange.path + app.selectedChange.staged}
        <ImageDiff path={app.selectedChange.path} before={img.before} after={img.after} />
      {/key}
    {:else}
      <DiffView {diff} path={app.selectedChange?.path ?? null} loading={loadingDiff} />
    {/if}
  </div>
</div>

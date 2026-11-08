<script lang="ts">
  /**
   * Resolve a conflicted file without leaving Orbe.
   *
   * Text conflicts are shown block by block, current (ours) next to incoming
   * (theirs), each with Accept current / incoming / both. "Edit" switches to
   * the full result as plain text for hand-tuning. Files git can't mark up
   * (binary, or deleted on one side) get a "keep this version" choice.
   */
  import { onMount } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import {
    ArrowDownUp,
    Check,
    ChevronDown,
    ChevronsUpDown,
    FileX2,
    GitMerge,
    LoaderCircle,
    Pencil,
    RotateCw,
    Rows2,
    Undo2,
  } from "@lucide/svelte";
  import { confirmAction, git, type ConflictInfo, type ConflictSide } from "../api";
  import { app, type RepoTab } from "../state.svelte";
  import { ui } from "../ui.svelte";
  import { isBold, isItalic, tokenize, type ThemedToken } from "../highlight";
  import { buildResult, chosenLines, hasMarkers, parseConflicts, type Choice, type ConflictBlock, type ParsedConflicts } from "../conflicts";
  import FileIcon from "./FileIcon.svelte";

  let { path }: { path: string } = $props();

  // The parent keys this view by tab and path, so the tab never changes under us.
  const tab: RepoTab = app.active;

  let loading = $state(true);
  let error = $state<string | null>(null);
  let info = $state<ConflictInfo | null>(null);
  let binary = $state(false);
  let tooLarge = $state(false);
  let text = $state<string | null>(null);
  let parsed = $state.raw<ParsedConflicts | null>(null);
  let tokens = $state.raw<ThemedToken[][] | null>(null);
  let choices = $state<(Choice | null)[]>([]);
  let editing = $state(false);
  let draft = $state("");
  /** The text Edit started from, to tell whether anything was typed. */
  let draftStart = "";
  let busy = $state<string | null>(null);
  /** Long unchanged stretches the user chose to show in full. */
  const expanded = new SvelteSet<number>();

  const total = $derived(parsed?.conflicts.length ?? 0);
  const resolved = $derived(choices.filter(Boolean).length);
  const allResolved = $derived(total > 0 && resolved === total);
  const markersLeft = $derived(editing ? hasMarkers(draft) : !allResolved);
  const fileName = $derived(path.split("/").pop() ?? path);

  /** Text conflicts are resolved block by block; everything else whole-file. */
  const showBlocks = $derived(!!parsed && total > 0);

  const oursName = $derived(info?.oursLabel || "Current");
  const theirsName = $derived(info?.theirsLabel || "Incoming");
  const rebasing = $derived(tab.operation === "rebase");

  onMount(load);

  async function load() {
    const repo = tab.repo;
    if (!repo) return;
    loading = true;
    error = null;
    editing = false;
    expanded.clear();
    try {
      const [i, content] = await Promise.all([
        git.conflictInfo(repo.path, path),
        // A side that deleted the file may leave nothing on disk.
        git.readFile(repo.path, path).catch(() => null),
      ]);
      info = i;
      binary = !!content?.binary;
      tooLarge = !!content?.truncated;
      text = content?.text ?? null;
      setText(text && !tooLarge ? text : null);
    } catch (e) {
      error = String(e);
    }
    loading = false;
  }

  /** Parse `value` into blocks and reset the choices. */
  function setText(value: string | null) {
    parsed = value != null ? parseConflicts(value) : null;
    choices = parsed ? parsed.conflicts.map(() => null) : [];
    tokens = null;
    if (parsed) {
      const p = parsed;
      tokenize(p.lines.join("\n"), path).then((t) => {
        if (parsed === p) tokens = t;
      });
    }
  }

  function choose(block: ConflictBlock, choice: Choice | null) {
    choices[block.index] = choice;
  }

  function chooseAll(choice: Choice) {
    choices = choices.map(() => choice);
  }

  function startEditing() {
    draft = draftStart = parsed ? buildResult(parsed, choices) : (text ?? "");
    editing = true;
  }

  /** Back to blocks: re-read the edited text, keeping what the user typed. */
  function stopEditing() {
    // Nothing typed: keep the blocks and choices exactly as they were.
    if (draft === draftStart) {
      editing = false;
      return;
    }
    const next = parseConflicts(draft);
    if (!next) {
      app.toast("error", "Conflict markers don't match", "Each <<<<<<< needs a ======= and a >>>>>>>. Fix them or remove them.");
      return;
    }
    text = draft;
    editing = false;
    expanded.clear();
    setText(draft);
  }

  async function markResolved() {
    const content = editing ? draft : parsed ? buildResult(parsed, choices) : text;
    if (content == null) return;
    if (hasMarkers(content)) {
      const ok = await confirmAction(
        `${fileName} still has conflict markers (<<<<<<< … >>>>>>>). Mark it resolved anyway?`,
        "Unresolved conflicts",
        "Mark resolved",
      );
      if (!ok) return;
    }
    busy = "save";
    await tab.saveResolution(path, content);
    busy = null;
  }

  async function keepSide(side: ConflictSide) {
    const deletes = side === "ours" ? !info?.ours : !info?.theirs;
    if (deletes) {
      const ok = await confirmAction(`Keep the deletion? ${fileName} will be removed.`, "Delete file", "Delete");
      if (!ok) return;
    }
    busy = side;
    await tab.resolveConflict(path, side);
    busy = null;
  }

  function wholeFileMenu(e: MouseEvent) {
    ui.menuBelow(e.currentTarget as HTMLElement, [
      { header: "Whole file" },
      { label: `Use current file (${oursName})`, icon: Check, run: () => keepSide("ours"), disabled: !!busy },
      { label: `Use incoming file (${theirsName})`, icon: Check, run: () => keepSide("theirs"), disabled: !!busy },
      { separator: true },
      { label: "Accept all current", icon: Rows2, run: () => chooseAll("ours"), disabled: editing || !total },
      { label: "Accept all incoming", icon: Rows2, run: () => chooseAll("theirs"), disabled: editing || !total },
      { label: "Accept all, both", icon: ChevronsUpDown, run: () => chooseAll("both"), disabled: editing || !total },
    ]);
  }

  function blockMenu(e: MouseEvent, block: ConflictBlock) {
    ui.menuBelow(e.currentTarget as HTMLElement, [
      { label: "Both, current first", icon: ChevronsUpDown, run: () => choose(block, "both") },
      { label: "Both, incoming first", icon: ArrowDownUp, run: () => choose(block, "both-reversed") },
    ]);
  }

  const CHOICE_NAMES: Record<Choice, string> = {
    ours: "kept current",
    theirs: "kept incoming",
    both: "kept both",
    "both-reversed": "kept both, incoming first",
  };

  /** Unchanged lines to show around a conflict before collapsing the rest. */
  const CONTEXT = 4;

  /** Visible slices of an unchanged stretch: head, hidden count, tail. */
  function contextOf(blockIndex: number, [from, to]: [number, number]) {
    const blocks = parsed!.blocks;
    const count = to - from;
    if (expanded.has(blockIndex) || count <= CONTEXT * 2 + 2) return { head: [from, to] as const, hidden: 0, tail: null };
    const first = blockIndex === 0;
    const last = blockIndex === blocks.length - 1;
    const headEnd = first ? from : from + CONTEXT;
    const tailStart = last ? to : to - CONTEXT;
    return { head: [from, headEnd] as const, hidden: tailStart - headEnd, tail: [tailStart, to] as const };
  }

  const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);
</script>

{#snippet line(i: number, number = true)}
  <div class="flex min-h-[21px]">
    {#if number}
      <span class="w-12 shrink-0 pr-3 text-right text-fg-faint/45 select-none">{i + 1}</span>
    {/if}
    <span class={["flex-1 pr-6 whitespace-pre", !number && "pl-3"]}
      >{#if tokens?.[i]}{#each tokens[i] as t, k (k)}<span style:color={t.color} class:italic={isItalic(t)} class:font-semibold={isBold(t)}
            >{t.content}</span
          >{/each}{:else}{parsed?.lines[i] ?? ""}{/if}</span
    >
  </div>
{/snippet}

{#snippet side(label: string, name: string, lines: number[], tone: "ours" | "theirs", block: ConflictBlock)}
  <div class={["min-w-0", tone === "ours" ? "bg-added/[0.06]" : "bg-renamed/[0.07]"]}>
    <button
      class={[
        "group/side flex w-full items-center gap-2 border-b border-line-soft px-3 py-1.5 text-left font-sans text-[11.5px] transition-colors",
        tone === "ours" ? "text-added hover:bg-added/10" : "text-renamed hover:bg-renamed/10",
      ]}
      title={`Accept ${label.toLowerCase()}`}
      onclick={() => choose(block, tone)}
    >
      <span class="font-semibold">{label}</span>
      <span class="min-w-0 flex-1 truncate opacity-75">{name}</span>
      <span class="opacity-0 transition-opacity group-hover/side:opacity-100">Accept</span>
    </button>
    <div class="overflow-x-auto py-1">
      {#each lines as i (i)}
        {@render line(i)}
      {:else}
        <div class="px-4 py-0.5 font-sans text-[12px] text-fg-faint italic">Nothing here (lines removed on this side)</div>
      {/each}
    </div>
  </div>
{/snippet}

<div class="@container flex h-full min-h-0 flex-col">
  <!-- Header -->
  <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-4 py-2.5">
    <span class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-conflict/30 bg-conflict/12 text-conflict">
      <GitMerge size={16} />
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-1.5 text-[13.5px] font-medium text-fg">
        <FileIcon {path} size={14} />
        <span class="truncate">{fileName}</span>
        <span class="truncate font-mono text-[11px] font-normal text-fg-faint">{path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""}</span>
      </div>
      {#if showBlocks && !editing}
        <div class="mt-1 flex items-center gap-2 text-[11.5px] text-fg-faint">
          <div class="h-1 w-24 overflow-hidden rounded-full bg-surface-3">
            <div class="h-full rounded-full bg-accent transition-[width] duration-300" style:width="{total ? (resolved / total) * 100 : 0}%"></div>
          </div>
          <span class="tabular-nums">{resolved} of {total} conflict{total === 1 ? "" : "s"} resolved</span>
        </div>
      {:else if editing}
        <div class="mt-1 text-[11.5px] text-fg-faint">
          Editing the result{#if markersLeft}<span class="text-modified"> · conflict markers left</span>{/if}
        </div>
      {:else}
        <div class="mt-1 text-[11.5px] text-fg-faint">Conflicted file</div>
      {/if}
    </div>

    <div class="flex items-center gap-1">
      <button class="icon-btn" title="Reload from disk (after editing it elsewhere)" disabled={!!busy} onclick={load}><RotateCw size={14} /></button>
      {#if showBlocks || editing}
        {#if editing}
          <button class="btn" onclick={stopEditing} title="Back to conflict blocks"><Rows2 size={14} /> Blocks</button>
        {:else}
          <button class="btn" onclick={startEditing} title="Edit the result by hand"><Pencil size={13} /> Edit</button>
        {/if}
      {/if}
      <button class="btn" onclick={wholeFileMenu} disabled={!!busy}>Accept all <ChevronDown size={13} /></button>
      {#if showBlocks || editing}
        <button
          class="btn-primary ml-1 h-8"
          disabled={!!busy || (!editing && !allResolved && total > 0)}
          title={!editing && !allResolved && total > 0 ? "Pick a side for every conflict first" : "Save the file and stage it"}
          onclick={markResolved}
        >
          {#if busy === "save"}<LoaderCircle size={14} class="animate-spin" />{:else}<Check size={14} strokeWidth={2.5} />{/if}
          Mark resolved
        </button>
      {/if}
    </div>
  </div>

  {#if !loading && !error && (parsed?.conflicts.length || editing)}
    <div class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft bg-black/10 px-4 py-1.5 text-[11.5px] text-fg-faint">
      <span class="flex min-w-0 items-center gap-1.5"><span class="size-2 shrink-0 rounded-full bg-added"></span><span class="text-added">Current</span><span class="truncate">{oursName}</span></span>
      <span class="flex min-w-0 items-center gap-1.5"><span class="size-2 shrink-0 rounded-full bg-renamed"></span><span class="text-renamed">Incoming</span><span class="truncate">{theirsName}</span></span>
      {#if rebasing}
        <span class="basis-full">Rebasing: <em>current</em> is the branch you're rebasing onto, <em>incoming</em> is your commit being replayed.</span>
      {/if}
    </div>
  {/if}

  <!-- Body -->
  <div class="min-h-0 flex-1 overflow-auto bg-black/25">
    {#if loading}
      <div class="space-y-2 p-5">
        {#each Array(10) as _, i (i)}
          <div class="h-3 animate-pulse rounded bg-surface-2" style:width="{30 + ((i * 41) % 60)}%"></div>
        {/each}
      </div>
    {:else if error}
      <div class="flex h-full items-center justify-center px-8 text-center text-[13px] text-fg-faint">{error}</div>
    {:else if editing}
      <textarea
        bind:value={draft}
        spellcheck="false"
        class="selectable block h-full w-full resize-none bg-transparent px-4 py-3 font-mono text-[12.5px] leading-[21px] text-[var(--code-fg)] outline-none"
      ></textarea>
    {:else if parsed && total > 0}
      <div class="py-2 font-mono text-[12.5px] leading-[21px] tracking-normal" style:color="var(--code-fg)">
        {#each parsed.blocks as block, b (b)}
          {#if block.kind === "text"}
            {@const ctx = contextOf(b, block.range)}
            <div class="overflow-x-auto">
              {#each range(ctx.head[0], ctx.head[1]) as i (i)}{@render line(i)}{/each}
            </div>
            {#if ctx.hidden > 0}
              <button
                class="my-1 flex w-full items-center gap-2 bg-surface-1 px-4 py-1 font-sans text-[11.5px] text-fg-faint transition-colors hover:bg-surface-2 hover:text-fg-muted"
                onclick={() => expanded.add(b)}
              >
                <ChevronsUpDown size={12} /> {ctx.hidden} unchanged line{ctx.hidden === 1 ? "" : "s"}
              </button>
            {/if}
            {#if ctx.tail}
              <div class="overflow-x-auto">
                {#each range(ctx.tail[0], ctx.tail[1]) as i (i)}{@render line(i)}{/each}
              </div>
            {/if}
          {:else}
            {@const choice = choices[block.index]}
            <div
              class={[
                "mx-3 my-2 overflow-hidden rounded-xl border transition-colors",
                choice ? "border-accent/30 bg-accent-soft/40" : "border-conflict/40 shadow-[0_0_24px_-12px_var(--color-conflict)]",
              ]}
            >
              <div class="flex flex-wrap items-center gap-1.5 border-b border-line-soft px-3 py-1.5 font-sans text-[12px]">
                {#if choice}
                  <Check size={13} class="text-accent" strokeWidth={2.5} />
                  <span class="font-semibold text-fg">Conflict {block.index + 1}</span>
                  <span class="text-fg-faint">· {CHOICE_NAMES[choice]}</span>
                  <span class="flex-1"></span>
                  <button class="btn h-6 px-2 text-[12px]" onclick={() => choose(block, null)}><Undo2 size={12} /> Undo</button>
                {:else}
                  <span class="size-1.5 rounded-full bg-conflict"></span>
                  <span class="font-semibold text-fg">Conflict {block.index + 1}</span>
                  <span class="flex-1"></span>
                  <button class="btn h-6 px-2 text-[12px] text-added hover:text-added" onclick={() => choose(block, "ours")}>Accept current</button>
                  <button class="btn h-6 px-2 text-[12px] text-renamed hover:text-renamed" onclick={() => choose(block, "theirs")}>Accept incoming</button>
                  <div class="flex">
                    <button class="btn h-6 rounded-r-none px-2 text-[12px]" onclick={() => choose(block, "both")}>Accept both</button>
                    <button class="btn h-6 rounded-l-none px-1" title="More ways to combine" onclick={(e) => blockMenu(e, block)}><ChevronDown size={12} /></button>
                  </div>
                {/if}
              </div>

              {#if choice}
                <div class="overflow-x-auto border-l-2 border-accent/60 py-1">
                  {#each chosenLines(block, choice) as i, k (k)}
                    {@render line(i)}
                  {:else}
                    <div class="px-4 py-0.5 font-sans text-[12px] text-fg-faint italic">Resolved to nothing (these lines are removed)</div>
                  {/each}
                </div>
              {:else}
                <div class="grid grid-cols-1 divide-y divide-line-soft @[760px]:grid-cols-2 @[760px]:divide-x @[760px]:divide-y-0">
                  {@render side("Current", oursName, range(block.ours[0], block.ours[1]), "ours", block)}
                  {@render side("Incoming", theirsName, range(block.theirs[0], block.theirs[1]), "theirs", block)}
                </div>
                {#if block.base}
                  <details class="border-t border-line-soft font-sans text-[11.5px]">
                    <summary class="cursor-pointer px-3 py-1 text-fg-faint select-none hover:text-fg-muted">Common ancestor</summary>
                    <div class="overflow-x-auto bg-black/20 py-1 font-mono text-[12.5px]">
                      {#each range(block.base[0], block.base[1]) as i (i)}{@render line(i)}{/each}
                    </div>
                  </details>
                {/if}
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {:else}
      <!-- Whole-file decision: binary, deleted on one side, or no markers left. -->
      {@const deletedOurs = info && !info.ours}
      {@const deletedTheirs = info && !info.theirs}
      {@const noMarkers = text != null && !binary && !tooLarge && !deletedOurs && !deletedTheirs}
      <div class="flex min-h-full items-center justify-center p-8">
        <div class="w-full max-w-[560px] animate-fade-in">
          <div class="text-center">
            <div class="mx-auto flex size-12 items-center justify-center rounded-2xl border border-conflict/30 bg-conflict/12 text-conflict">
              {#if deletedOurs || deletedTheirs}<FileX2 size={20} />{:else}<GitMerge size={20} />{/if}
            </div>
            <p class="mt-3 font-display text-[18px] text-fg">
              {#if deletedOurs}Deleted on the current side, changed on the incoming one
              {:else if deletedTheirs}Changed on the current side, deleted on the incoming one
              {:else if binary}Both sides changed this binary file
              {:else if tooLarge}This file is too large to edit here
              {:else if noMarkers}No conflict markers left
              {:else}Pick the version to keep{/if}
            </p>
            <p class="mt-1 text-[12.5px] text-fg-faint">
              {#if noMarkers}
                It looks fixed already. Mark it resolved to stage it, or keep one side as it was.
              {:else}
                Choose which version of <span class="font-mono text-fg-muted">{fileName}</span> to keep.
              {/if}
            </p>
          </div>

          {#if noMarkers}
            <div class="mt-5 flex justify-center gap-2">
              <button class="btn-ghost" onclick={startEditing}><Pencil size={13} /> Review</button>
              <button class="btn-primary" disabled={!!busy} onclick={markResolved}>
                {#if busy === "save"}<LoaderCircle size={14} class="animate-spin" />{:else}<Check size={14} strokeWidth={2.5} />{/if}
                Mark resolved
              </button>
            </div>
          {/if}

          <div class="mt-5 grid grid-cols-2 gap-3">
            {#each [{ side: "ours", label: "Current", name: oursName, gone: deletedOurs, tone: "added" }, { side: "theirs", label: "Incoming", name: theirsName, gone: deletedTheirs, tone: "renamed" }] as opt (opt.side)}
              <button
                class={[
                  "glass group flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors disabled:opacity-50",
                  opt.tone === "added" ? "border-added/25 hover:border-added/60" : "border-renamed/25 hover:border-renamed/60",
                ]}
                disabled={!!busy}
                onclick={() => keepSide(opt.side as ConflictSide)}
              >
                <span class={["text-[11px] font-semibold tracking-[0.06em] uppercase", opt.tone === "added" ? "text-added" : "text-renamed"]}>{opt.label}</span>
                <span class="w-full truncate text-[12px] text-fg-faint">{opt.name}</span>
                <span class="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-fg">
                  {#if busy === opt.side}<LoaderCircle size={13} class="animate-spin" />{/if}
                  {opt.gone ? "Keep it deleted" : "Keep this version"}
                </span>
              </button>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

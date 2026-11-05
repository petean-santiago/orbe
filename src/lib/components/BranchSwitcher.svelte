<script lang="ts">
  import { Check, Cloud, GitBranch, GitBranchPlus, LoaderCircle, Search } from "@lucide/svelte";
  import { fly } from "svelte/transition";
  import type { Branch } from "../api";
  import { app } from "../state.svelte";
  import { ui } from "../ui.svelte";
  import { modKey, refNameError, relativeTime } from "../format";
  import { newBranch } from "../actions";

  type Row =
    | { kind: "create"; name: string }
    | { kind: "branch"; branch: Branch; hits: number[]; group: "Local" | "Remote" };

  let query = $state("");
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();
  let panel: HTMLDivElement | undefined = $state();

  // Anchor under the toolbar's branch button when it's visible, else centre.
  const anchor = document.querySelector<HTMLElement>("[data-branch-anchor]")?.getBoundingClientRect();
  const width = Math.min(440, window.innerWidth - 24);
  const left = anchor ? Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12)) : null;
  const top = anchor ? anchor.bottom + 8 : 96;

  /** Subsequence match; returns matched character indices, best for contiguous runs. */
  function fuzzy(name: string, q: string): number[] | null {
    if (!q) return [];
    const lower = name.toLowerCase();
    const at = lower.indexOf(q);
    if (at !== -1) return Array.from({ length: q.length }, (_, i) => at + i);
    const hits: number[] = [];
    let j = 0;
    for (let i = 0; i < lower.length && j < q.length; i++) if (lower[i] === q[j]) (hits.push(i), j++);
    return j === q.length ? hits : null;
  }

  const rows = $derived.by<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const score = (hits: number[]) => (hits.length && hits[hits.length - 1] - hits[0] === hits.length - 1 ? 0 : 1);
    const pick = (list: Branch[], group: "Local" | "Remote") =>
      list
        .map((branch) => ({ branch, hits: fuzzy(branch.name, q) }))
        .filter((r): r is { branch: Branch; hits: number[] } => r.hits !== null)
        .sort(
          (a, b) =>
            Number(b.branch.isHead) - Number(a.branch.isHead) ||
            score(a.hits) - score(b.hits) ||
            b.branch.updated - a.branch.updated,
        )
        .map((r) => ({ kind: "branch" as const, group, ...r }));

    const locals = app.branches.filter((b) => b.kind === "local");
    // Remotes that already have a local branch are reached through it.
    const remotes = app.branches.filter((b) => b.kind === "remote" && !locals.some((l) => l.upstream === b.name));
    const out: Row[] = [...pick(locals, "Local"), ...pick(remotes, "Remote").slice(0, 60)];

    const typed = query.trim();
    if (typed && !refNameError(typed) && !locals.some((b) => b.name === typed)) {
      out.push({ kind: "create", name: typed });
    }
    return out;
  });

  $effect(() => {
    void query;
    // Start on the first branch you could switch to (skip the current one).
    const first = rows.findIndex((r) => r.kind === "create" || !r.branch.isHead);
    active = Math.max(0, first);
  });

  $effect(() => {
    input?.focus();
  });

  function close() {
    ui.branchSwitcher = false;
  }

  function choose(row: Row | undefined) {
    if (!row) return;
    close();
    if (row.kind === "create") app.active.createBranch(row.name, null, true);
    else if (!row.branch.isHead) app.checkout(row.branch);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = rows.length;
      if (!n) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      listEl?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        close();
        newBranch(null, query.trim());
      } else {
        choose(rows[active]);
      }
    }
  }

  function onOutside(e: PointerEvent) {
    const t = e.target as HTMLElement;
    if (panel && !panel.contains(t) && !t.closest("[data-branch-anchor]")) close();
  }
</script>

<svelte:window onpointerdown={onOutside} />

{#snippet name(text: string, hits: number[])}
  {#each text as ch, i}
    {#if hits.includes(i)}<span class="font-semibold text-accent-fg">{ch}</span>{:else}{ch}{/if}
  {/each}
{/snippet}

<div
  bind:this={panel}
  role="dialog"
  aria-label="Switch branch"
  tabindex="-1"
  class="glass-strong fixed z-50 flex flex-col overflow-hidden rounded-2xl"
  style:width="{width}px"
  style:left={left !== null ? `${left}px` : "50%"}
  style:top="{top}px"
  style:translate={left === null ? "-50% 0" : undefined}
  transition:fly={{ y: -6, duration: 150 }}
  onkeydown={onKey}
>
  <div class="flex items-center gap-2.5 border-b border-line px-3.5">
    <Search size={15} class="text-accent" />
    <input
      bind:this={input}
      bind:value={query}
      placeholder="Switch to a branch, or type a new name…"
      spellcheck="false"
      class="h-11 flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-fg-faint"
    />
    <button class="icon-btn size-7" title="New branch…" onclick={() => (close(), newBranch(null, query.trim()))}>
      <GitBranchPlus size={15} />
    </button>
  </div>

  <div bind:this={listEl} class="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
    {#each rows as row, i (row.kind === "create" ? "create" : row.branch.kind + row.branch.name)}
      {@const prev = rows[i - 1]}
      {#if row.kind === "branch" && (!prev || prev.kind !== "branch" || prev.group !== row.group)}
        <div class="section-label px-2.5 pt-2 pb-1">{row.group}</div>
      {/if}
      {#if row.kind === "create"}
        <div class="mx-2 my-1 h-px bg-line-soft"></div>
        <button
          data-idx={i}
          class={["flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px]", i === active ? "bg-accent-soft text-fg" : "text-fg-muted"]}
          onmousemove={() => (active = i)}
          onclick={() => choose(row)}
        >
          <GitBranchPlus size={15} class="text-accent" />
          <span class="min-w-0 flex-1 truncate">Create and switch to <span class="font-mono text-fg">{row.name}</span></span>
        </button>
      {:else}
        {@const b = row.branch}
        {@const pending = app.active.pendingCheckout === b.name}
        <button
          data-idx={i}
          class={[
            "group flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors duration-75",
            i === active ? "bg-accent-soft text-fg" : "text-fg-muted",
          ]}
          onmousemove={() => (active = i)}
          onclick={() => choose(row)}
        >
          {#if pending}
            <LoaderCircle size={14} class="animate-spin text-accent" />
          {:else if b.isHead}
            <Check size={14} strokeWidth={2.6} class="text-accent" />
          {:else if b.kind === "remote"}
            <Cloud size={14} class="text-fg-faint" />
          {:else}
            <GitBranch size={14} class={i === active ? "text-accent" : "text-fg-faint"} />
          {/if}
          <span class={["min-w-0 flex-1 truncate", b.isHead && "text-fg"]}>{@render name(b.name, row.hits)}</span>
          {#if b.behind > 0}<span class="text-[11px] text-fg-faint tabular-nums">↓{b.behind}</span>{/if}
          {#if b.ahead > 0}<span class="text-[11px] text-accent-fg tabular-nums">↑{b.ahead}</span>{/if}
          {#if b.isHead}
            <span class="rounded-full bg-accent-strong/80 px-1.5 text-[10.5px] leading-4 font-semibold text-white">current</span>
          {:else if b.updated}
            <span class="w-[86px] shrink-0 truncate text-right text-[11.5px] text-fg-faint">{relativeTime(b.updated)}</span>
          {/if}
        </button>
      {/if}
    {:else}
      <div class="px-3 py-8 text-center text-[13px] text-fg-faint">
        {query.trim() ? `"${query.trim()}" isn't a valid branch name` : "No branches yet"}
      </div>
    {/each}
  </div>

  <footer class="flex items-center gap-3 border-t border-line-soft bg-black/20 px-3.5 py-2 text-[11px] text-fg-faint">
    <span><span class="kbd">↵</span> switch</span>
    <span><span class="kbd">{modKey}</span> <span class="kbd">↵</span> new branch</span>
    <span class="flex-1"></span>
    <span><span class="kbd">esc</span> close</span>
  </footer>
</div>

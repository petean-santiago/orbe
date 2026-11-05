<script lang="ts">
  import { ChevronRight, Cloud, FileDiff, GitBranch, GitGraph, Tag } from "@lucide/svelte";
  import { slide } from "svelte/transition";
  import type { Branch } from "../api";
  import { app, type View } from "../state.svelte";
  import { settings } from "../settings.svelte";

  const local = $derived(app.branches.filter((b) => b.kind === "local"));
  const remote = $derived(app.branches.filter((b) => b.kind === "remote"));
  const tags = $derived(app.branches.filter((b) => b.kind === "tag"));

  let open = $state({ local: true, remote: true, tags: false });

  const nav: { view: View; label: string; icon: typeof GitGraph }[] = [
    { view: "changes", label: "Changes", icon: FileDiff },
    { view: "history", label: "History", icon: GitGraph },
  ];

  function jumpTo(b: Branch) {
    const refName = b.kind === "tag" ? `tag: ${b.name}` : b.name;
    const commit = app.commits.find((c) =>
      c.refs.some((r) => r === refName || r === `HEAD -> ${b.name}`),
    );
    if (commit) {
      app.view = "history";
      app.selectedHash = commit.hash;
    }
  }
</script>

{#snippet section(key: keyof typeof open, label: string, items: Branch[], Icon: typeof GitBranch)}
  <div class="mt-3">
    <button
      class="group flex w-full items-center gap-1 pr-3 text-left"
      onclick={() => (open[key] = !open[key])}
    >
      <span class="section-label flex flex-1 items-center gap-1 pr-0">
        <ChevronRight
          size={11}
          strokeWidth={2.5}
          class="-ml-1 transition-transform duration-200 {open[key] ? 'rotate-90' : ''}"
        />
        {label}
      </span>
      <span class="text-[11px] text-fg-faint tabular-nums opacity-0 transition-opacity group-hover:opacity-100">
        {items.length}
      </span>
    </button>
    {#if open[key]}
      <ul transition:slide={{ duration: 180 }} class="mt-1 px-2">
        {#each items as b (b.kind + b.name)}
          <li>
            <button
              class={[
                "group flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors",
                b.isHead ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
              ]}
              title={b.kind === "tag" ? b.name : `${b.name} — double-click to check out`}
              onclick={() => jumpTo(b)}
              ondblclick={() => app.checkout(b)}
            >
              <Icon
                size={13}
                strokeWidth={2}
                class={b.isHead ? "text-accent" : "text-fg-faint group-hover:text-fg-muted"}
              />
              <span class="min-w-0 flex-1 truncate">{b.name}</span>
              {#if b.behind > 0}
                <span class="text-[11px] text-fg-faint tabular-nums">↓{b.behind}</span>
              {/if}
              {#if b.ahead > 0}
                <span class="text-[11px] text-accent-fg tabular-nums">↑{b.ahead}</span>
              {/if}
              {#if b.isHead}
                <span class="size-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]"></span>
              {/if}
            </button>
          </li>
        {:else}
          <li class="px-2 py-1 text-[12px] text-fg-faint italic">None</li>
        {/each}
      </ul>
    {/if}
  </div>
{/snippet}

<aside class="glass flex w-[256px] shrink-0 flex-col overflow-hidden rounded-2xl">
  <div class="min-h-0 flex-1 overflow-y-auto pt-2 pb-4">
    {#each settings.value.sidebarSections.filter((sec) => sec.visible) as sec (sec.id)}
      {#if sec.id === "workspace"}
        <nav class="flex flex-col gap-0.5 px-2 pt-1 pb-1">
          {#each nav as item}
            {@const active = app.view === item.view}
            {@const count = item.view === "changes" ? app.status.length : 0}
            <button
              class={[
                "relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors",
                active ? "bg-accent-soft text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
              ]}
              onclick={() => (app.view = item.view)}
            >
              {#if active}
                <span class="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]"></span>
              {/if}
              <item.icon size={16} class={active ? "text-accent" : ""} />
              <span class="flex-1 text-left">{item.label}</span>
              {#if count > 0}
                <span class="rounded-full bg-surface-4 px-2 text-[11px] leading-[18px] font-semibold text-fg tabular-nums">
                  {count}
                </span>
              {/if}
            </button>
          {/each}
        </nav>
      {:else if sec.id === "branches"}
        {@render section("local", "Branches", local, GitBranch)}
      {:else if sec.id === "remotes"}
        {@render section("remote", "Remotes", remote, Cloud)}
      {:else if sec.id === "tags"}
        {@render section("tags", "Tags", tags, Tag)}
      {/if}
    {/each}
  </div>

  {#if app.repo}
    <div class="selectable truncate border-t border-line-soft px-3.5 py-2.5 font-mono text-[11px] text-fg-faint" title={app.repo.path}>
      {app.repo.path}
    </div>
  {/if}
</aside>

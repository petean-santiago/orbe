<script lang="ts">
  import { ArrowDown, ArrowUp, ChevronDown, GitBranch, LoaderCircle, RefreshCw, Search } from "@lucide/svelte";
  import { app, type RemoteOp } from "../state.svelte";
  import { settings, type ToolbarItemId } from "../settings.svelte";
  import { modKey } from "../format";

  const head = $derived(app.headBranch);

  const ops: Record<RemoteOp, { label: string; icon: typeof RefreshCw; count: () => number }> = {
    fetch: { label: "Fetch", icon: RefreshCw, count: () => 0 },
    pull: { label: "Pull", icon: ArrowDown, count: () => head?.behind ?? 0 },
    push: { label: "Push", icon: ArrowUp, count: () => head?.ahead ?? 0 },
  };

  const isOp = (id: ToolbarItemId): id is RemoteOp => id in ops;
</script>

<div class="flex h-11 shrink-0 items-center gap-1 px-3">
  {#each settings.value.toolbar as item (item.id)}
    {#if item.id === "search"}
      <div class="flex min-w-0 flex-1 justify-center px-3">
        {#if item.visible}
          <button
            class="glass-well flex h-8 w-full max-w-[460px] items-center gap-2.5 rounded-lg px-3 text-[13px] text-fg-faint transition-colors hover:text-fg-muted"
            onclick={() => (app.paletteOpen = true)}
          >
            <Search size={14} />
            <span class="flex-1 truncate text-left">Search commits, branches, actions…</span>
            <span class="kbd">{modKey}</span><span class="kbd -ml-1.5">K</span>
          </button>
        {/if}
      </div>
    {:else if !item.visible}
      <!-- hidden -->
    {:else if item.id === "branch"}
      {#if head || app.repo?.head}
        <button
          class="inline-flex h-8 max-w-[260px] items-center gap-2 rounded-lg border border-accent/25 bg-accent-soft px-3 text-[13px] font-medium text-accent-fg transition-colors hover:border-accent/45"
          title="Switch branch"
          onclick={() => (app.paletteOpen = true)}
        >
          <GitBranch size={14} strokeWidth={2.2} class="shrink-0" />
          <span class="truncate">{head?.name ?? app.repo?.head}</span>
          <ChevronDown size={13} class="shrink-0 opacity-60" />
        </button>
      {/if}
    {:else if isOp(item.id)}
      {@const op = item.id}
      {@const meta = ops[op]}
      {@const n = meta.count()}
      <button class="btn h-8 px-3" onclick={() => app.remote(op)} disabled={!!app.remoteOp} title={meta.label}>
        {#if app.remoteOp === op}
          <LoaderCircle size={15} class="animate-spin text-accent" />
        {:else}
          <meta.icon size={15} />
        {/if}
        {meta.label}
        {#if n > 0}
          <span class="ml-0.5 rounded-full bg-accent-strong px-1.5 text-[11px] leading-4 font-semibold text-white shadow-[0_0_10px_var(--color-accent-glow)]">{n}</span>
        {/if}
      </button>
    {/if}
  {/each}
</div>

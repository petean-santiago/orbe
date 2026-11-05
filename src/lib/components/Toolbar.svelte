<script lang="ts">
  import {
    ArrowDown,
    ArrowUp,
    ChevronDown,
    GitBranch,
    LoaderCircle,
    Plus,
    RefreshCw,
    Search,
    Sparkles,
  } from "@lucide/svelte";
  import { app, type RemoteOp } from "../state.svelte";
  import { settings, type ToolbarItemId } from "../settings.svelte";
  import { ui } from "../ui.svelte";
  import { isMac, modKey } from "../format";
  import { createMenuItems } from "../actions";

  const head = $derived(app.headBranch);
  const switching = $derived(app.active.pendingCheckout !== null);

  const ops: Record<RemoteOp, { label: string; icon: typeof RefreshCw; count: () => number }> = {
    fetch: { label: "Fetch", icon: RefreshCw, count: () => 0 },
    pull: { label: "Pull", icon: ArrowDown, count: () => head?.behind ?? 0 },
    push: { label: "Push", icon: ArrowUp, count: () => head?.ahead ?? 0 },
  };

  const isOp = (id: ToolbarItemId): id is RemoteOp => id in ops;
  const branchKey = isMac ? "⌘B" : "Ctrl+B";
</script>

<!-- Container queries collapse labels to icons as the window narrows. -->
<div class="@container flex h-11 shrink-0 items-center gap-1 px-3">
  {#each settings.value.toolbar as item (item.id)}
    {#if item.id === "search"}
      <div class="flex min-w-0 flex-1 justify-center px-3 @max-[720px]:px-1">
        {#if item.visible}
          <button
            class="glass-well flex h-8 w-full max-w-[460px] items-center gap-2.5 rounded-lg px-3 text-[13px] text-fg-faint transition-colors hover:text-fg-muted @max-[720px]:hidden"
            onclick={() => (app.paletteOpen = true)}
          >
            <Search size={14} class="shrink-0" />
            <span class="flex-1 truncate text-left">Search commits, branches, actions…</span>
            <span class="kbd @max-[900px]:hidden">{modKey}</span><span class="kbd -ml-1.5 @max-[900px]:hidden">K</span>
          </button>
          <button class="icon-btn size-8 @min-[720px]:hidden" title="Search ({modKey}+K)" onclick={() => (app.paletteOpen = true)}>
            <Search size={15} />
          </button>
        {/if}
      </div>
    {:else if !item.visible}
      <!-- hidden -->
    {:else if item.id === "branch"}
      {#if head || app.repo?.head}
        <button
          data-branch-anchor
          class={[
            "inline-flex h-8 max-w-[280px] min-w-0 items-center @max-[760px]:max-w-[150px] gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors",
            ui.branchSwitcher
              ? "border-accent/60 bg-accent-soft text-fg shadow-[0_0_0_3px_var(--color-accent-soft)]"
              : "border-accent/25 bg-accent-soft text-accent-fg hover:border-accent/45",
          ]}
          title="Switch branch ({branchKey})"
          onclick={() => (ui.branchSwitcher = !ui.branchSwitcher)}
        >
          {#if switching}
            <LoaderCircle size={14} class="shrink-0 animate-spin" />
          {:else}
            <GitBranch size={14} strokeWidth={2.2} class="shrink-0" />
          {/if}
          <span class="truncate">{head?.name ?? app.repo?.head}</span>
          <ChevronDown size={13} class={["shrink-0 opacity-60 transition-transform", ui.branchSwitcher && "rotate-180"]} />
        </button>
      {/if}
    {:else if item.id === "create"}
      <button
        class="btn h-8 px-2.5"
        title="Create a branch, tag, file, folder or repository"
        onclick={(e) => ui.menuBelow(e.currentTarget, createMenuItems())}
      >
        <Plus size={15} /> <span class="@max-[880px]:hidden">New</span>
        <ChevronDown size={12} class="opacity-60" />
      </button>
    {:else if item.id === "assistant"}
      <button
        class={[
          "btn h-8 px-3",
          ui.assistant && "!border-accent/50 !bg-accent-soft !text-fg shadow-[0_0_14px_-4px_var(--color-accent-glow)]",
        ]}
        title="AI assistant ({modKey}+J)"
        onclick={() => (ui.assistant = !ui.assistant)}
      >
        <Sparkles size={15} class={ui.assistant ? "text-accent" : ""} />
        <span class="@max-[1000px]:hidden">Ask AI</span>
      </button>
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
        <span class="@max-[880px]:hidden">{meta.label}</span>
        {#if n > 0}
          <span class="ml-0.5 rounded-full bg-accent-strong px-1.5 text-[11px] leading-4 font-semibold text-white shadow-[0_0_10px_var(--color-accent-glow)]">{n}</span>
        {/if}
      </button>
    {/if}
  {/each}
</div>

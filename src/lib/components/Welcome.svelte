<script lang="ts">
  import { Download, Folder, FolderOpen, FolderPlus, LoaderCircle, X } from "@lucide/svelte";
  import { cloneRepository, createRepository } from "../actions";
  import { app } from "../state.svelte";
  import { modKey } from "../format";
  import { isTauri } from "../api";
  import Logo from "./Logo.svelte";

  function ago(ms: number) {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }
</script>

<div class="relative flex h-full items-center justify-center overflow-hidden">
  <!-- ambient background -->
  <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_45%_40%_at_50%_32%,oklch(0.5_0.26_330/0.28),transparent_70%)]"></div>
  <div
    class="pointer-events-none absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_40%,black,transparent)]"
    style:background-image="radial-gradient(oklch(1 0 0 / 0.12) 1px, transparent 1px)"
    style:background-size="22px 22px"
  ></div>

  <div class="relative flex w-[440px] animate-fade-in flex-col items-center">
    <div class="animate-float">
      <Logo size={132} glow animated />
    </div>
    <h1 class="mt-6 bg-gradient-to-b from-white via-white to-accent bg-clip-text font-display text-[40px] font-semibold tracking-[-0.04em] text-transparent">
      Orbe
    </h1>
    <p class="mt-1.5 text-[13.5px] text-fg-muted">A calm, beautiful home for your repositories.</p>

    <div class="mt-8 flex gap-2.5">
      <button class="btn-primary h-9 px-4 text-[13px]" onclick={() => app.openFolder()} disabled={app.loading}>
        <FolderOpen size={15} />
        {app.loading ? "Opening…" : "Open repository"}
      </button>
      <button class="btn h-9 px-4 text-[13px]" onclick={cloneRepository} disabled={!!app.cloning}>
        {#if app.cloning}<LoaderCircle size={15} class="animate-spin text-accent" />{:else}<Download size={15} />{/if}
        {app.cloning ? "Cloning…" : "Clone"}
      </button>
      <button class="btn h-9 px-4 text-[13px]" onclick={createRepository}>
        <FolderPlus size={15} /> New
      </button>
    </div>
    <p class="mt-3 text-[12px] text-fg-faint">
      or press <span class="kbd">{modKey}</span> <span class="kbd">O</span>
    </p>

    {#if app.recents.length}
      <div class="mt-10 w-full">
        <div class="section-label mb-2 px-1">Recent</div>
        <ul class="glass overflow-hidden rounded-2xl">
          {#each app.recents as r (r.path)}
            <li class="group relative border-b border-line-soft last:border-b-0">
              <button
                class="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2"
                onclick={() => app.open(r.path)}
              >
                <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                  <Folder size={15} />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[13px] font-medium text-fg">{r.name}</span>
                  <span class="block truncate font-mono text-[11px] text-fg-faint">{r.path}</span>
                </span>
                <span class="text-[11px] text-fg-faint transition-opacity group-hover:opacity-0">{ago(r.openedAt)}</span>
              </button>
              <button
                class="icon-btn absolute top-1/2 right-2.5 size-6 -translate-y-1/2 opacity-0 group-hover:opacity-100"
                title="Remove from recents"
                onclick={() => app.forgetRecent(r.path)}
              >
                <X size={13} />
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if !isTauri}
      <p class="mt-8 glass rounded-full px-3 py-1 text-[11px] text-fg-faint">
        Browser preview — showing a demo repository
      </p>
    {/if}
  </div>
</div>

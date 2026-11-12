<script lang="ts">
  /** What's new in the version the title-bar pill announces, with the download link. */
  import { Download, Sparkles, X } from "@lucide/svelte";
  import { fade, fly } from "svelte/transition";
  import { updates } from "../updates.svelte";

  const release = $derived(updates.available ?? updates.latest);

  function close() {
    updates.dialogOpen = false;
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

{#if release}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div role="presentation" class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6" transition:fade={{ duration: 140 }} onclick={close}>
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Orbe {release.version} is available"
      tabindex="-1"
      class="glass-strong flex max-h-full w-[min(460px,100%)] flex-col overflow-hidden rounded-2xl"
      transition:fly={{ y: 10, duration: 200 }}
      onclick={(e) => e.stopPropagation()}
    >
      <header class="flex items-start gap-3 border-b border-line-soft px-6 py-5">
        <span class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent-soft text-accent">
          <Sparkles size={19} />
        </span>
        <div class="min-w-0 flex-1">
          <h2 class="font-display text-[19px] leading-tight text-fg">Orbe {release.version} is available</h2>
          <p class="mt-1 text-[12.5px] text-fg-faint">
            You have {updates.current}{release.date ? ` · released ${release.date}` : ""}
          </p>
        </div>
        <button class="icon-btn size-8 shrink-0 rounded-lg" aria-label="Close" onclick={close}><X size={16} /></button>
      </header>
      {#if release.notes.length}
        <div class="min-h-0 overflow-y-auto px-6 py-4">
          <p class="mb-2 text-[11px] font-semibold tracking-[0.06em] text-fg-faint uppercase">What's new</p>
          <ul class="space-y-1.5 text-[13px] leading-relaxed text-fg-muted">
            {#each release.notes as note, i (i)}
              <li class="flex gap-2"><span class="mt-[8px] size-1.5 shrink-0 rounded-full bg-accent"></span><span>{note}</span></li>
            {/each}
          </ul>
        </div>
      {/if}
      <footer class="flex items-center justify-between gap-2 border-t border-line-soft px-6 py-4">
        <button class="text-[12.5px] text-fg-faint hover:text-fg-muted" onclick={() => updates.skip()}>Skip this version</button>
        <div class="flex gap-2">
          <button class="btn h-9 px-3" onclick={close}>Later</button>
          <button class="btn-primary h-9" onclick={() => (updates.download(), close())}><Download size={14} /> Download</button>
        </div>
      </footer>
    </div>
  </div>
{/if}

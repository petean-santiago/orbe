<script lang="ts">
  import { CircleCheck, CircleX, Info, X } from "@lucide/svelte";
  import { fly } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { app } from "../state.svelte";

  const icons = { success: CircleCheck, error: CircleX, info: Info };
  const colors = { success: "var(--color-added)", error: "var(--color-deleted)", info: "var(--color-accent)" };
</script>

<div class="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[360px] flex-col gap-2">
  {#each app.toasts as toast (toast.id)}
    {@const Icon = icons[toast.kind]}
    <div
      animate:flip={{ duration: 200 }}
      in:fly={{ y: 12, duration: 220 }}
      out:fly={{ x: 24, duration: 160 }}
      class="pointer-events-auto flex items-start gap-3 glass-strong rounded-xl p-3"
    >
      <span class="mt-px" style:color={colors[toast.kind]}><Icon size={17} /></span>
      <div class="min-w-0 flex-1">
        <div class="text-[13px] font-semibold text-fg">{toast.title}</div>
        {#if toast.message}
          <div class="selectable mt-0.5 line-clamp-4 text-[12px] break-words whitespace-pre-wrap text-fg-muted">{toast.message}</div>
        {/if}
      </div>
      <button class="icon-btn -mt-1 -mr-1 size-6" aria-label="Dismiss" onclick={() => app.dismiss(toast.id)}>
        <X size={14} />
      </button>
    </div>
  {/each}
</div>

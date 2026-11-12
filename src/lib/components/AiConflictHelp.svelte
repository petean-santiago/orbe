<script lang="ts">
  /**
   * The "?" next to Resolve with AI: explains the criterion the AI follows
   * (from Settings → AI) and how its answers are applied.
   */
  import { CircleHelp, Settings2, Sparkles } from "@lucide/svelte";
  import { fly } from "svelte/transition";
  import { aiReady, providerLabel } from "../assistant.svelte";
  import { settings, CONFLICT_STRATEGIES } from "../settings.svelte";
  import { app } from "../state.svelte";
  import { ui } from "../ui.svelte";

  let { class: className = "", compact = false }: { class?: string; compact?: boolean } = $props();

  let open = $state(false);
  let root = $state<HTMLElement | null>(null);

  const strategy = $derived(CONFLICT_STRATEGIES[settings.value.ai.conflicts.strategy]);
  const ownRules = $derived(settings.value.ai.conflicts.instructions.trim());

  function openSettings() {
    open = false;
    ui.settingsPage = "ai";
    app.settingsOpen = true;
  }

  function onPointer(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onpointerdown={onPointer} onkeydown={(e) => open && e.key === "Escape" && (open = false)} />

<div class="relative flex" bind:this={root}>
  <button
    class={[className, open && "bg-accent-soft text-fg"]}
    title="How does the AI decide?"
    aria-label="How does the AI decide?"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <CircleHelp size={compact ? 13 : 14} />
  </button>
  {#if open}
    <div
      class="glass-strong absolute top-full right-0 z-50 mt-2 w-[340px] rounded-xl p-4 text-left text-[12.5px] leading-relaxed font-normal text-fg-muted shadow-2xl"
      transition:fly={{ y: -4, duration: 140 }}
    >
      <div class="flex items-center gap-2 text-[13.5px] font-semibold text-fg"><Sparkles size={14} class="text-accent" /> How the AI resolves conflicts</div>
      <div class="mt-3 rounded-lg border border-accent/25 bg-accent-soft px-3 py-2">
        <div class="text-[11px] font-semibold tracking-[0.06em] text-accent uppercase">Criterion · {strategy.label}</div>
        <p class="mt-0.5 text-fg">{strategy.description}</p>
        {#if ownRules}
          <div class="mt-2 text-[11px] font-semibold tracking-[0.06em] text-accent uppercase">Your rules</div>
          <p class="mt-0.5 line-clamp-4 whitespace-pre-line text-fg">{ownRules}</p>
        {/if}
      </div>
      <ul class="mt-3 space-y-1.5">
        <li>• It only decides the conflicts you haven't picked; your choices stay.</li>
        <li>• For each one it keeps current, incoming or both, or writes a merged version, and tells you why.</li>
        <li>• It uses the common ancestor (when git kept it) and the code around the conflict to keep the file valid.</li>
        <li>• When it isn't confident, it leaves the conflict for you.</li>
        <li>• Files deleted on one side or binary files are left for you to choose.</li>
        <li>• Nothing is saved until you click <span class="text-fg">Mark resolved</span> on each file; Undo any block you disagree with.</li>
      </ul>
      <p class="mt-3 text-[11.5px] text-fg-faint">Sends the conflicts and nearby code to {aiReady() ? providerLabel() : "your AI provider"}.</p>
      <button class="btn mt-3 h-7 w-full justify-center text-[12px]" onclick={openSettings}><Settings2 size={13} /> Change criterion in Settings</button>
    </div>
  {/if}
</div>

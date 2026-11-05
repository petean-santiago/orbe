<script lang="ts">
  import { Minus, Square, X } from "@lucide/svelte";
  import { windowAction } from "../api";
</script>

<div class="flex h-full items-stretch">
  <button class="win-btn" aria-label="Minimize" onclick={() => windowAction("minimize")}>
    <Minus size={15} strokeWidth={1.5} />
  </button>
  <button class="win-btn" aria-label="Maximize" onclick={() => windowAction("toggleMaximize")}>
    <Square size={12} strokeWidth={1.5} />
  </button>
  <button class="win-btn close" aria-label="Close" onclick={() => windowAction("close")}>
    <X size={16} strokeWidth={1.5} />
  </button>
</div>

<style>
  .win-btn {
    display: inline-flex;
    width: 46px;
    align-items: center;
    justify-content: center;
    color: var(--color-fg-muted);
    transition: background-color 120ms, color 120ms;
  }
  .win-btn:hover {
    background: var(--color-surface-3);
    color: var(--color-fg);
  }
  .win-btn.close:hover {
    background: oklch(0.58 0.22 25);
    color: white;
  }
</style>

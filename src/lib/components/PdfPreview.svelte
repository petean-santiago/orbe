<script lang="ts">
  /** PDF preview using the webview's built-in PDF viewer. */
  import { LoaderCircle } from "@lucide/svelte";
  import { git } from "../api";
  import { app } from "../state.svelte";

  let { path }: { path: string } = $props();

  let url = $state<string | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    const repo = app.repo;
    if (!repo) return;
    let cancelled = false;
    let made: string | null = null;
    git
      .readFileBase64(repo.path, path)
      .then((b64) => {
        if (cancelled) return;
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        made = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        url = made;
      })
      .catch((e) => !cancelled && (error = String(e)));
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  });
</script>

{#if error}
  <div class="flex h-full items-center justify-center px-8 text-center text-[13px] text-fg-faint">{error}</div>
{:else if !url}
  <div class="flex h-full items-center justify-center"><LoaderCircle size={20} class="animate-spin text-fg-faint" /></div>
{:else}
  <iframe src={url} title={path} class="h-full w-full border-0 bg-[oklch(0.2_0.01_300)]"></iframe>
{/if}

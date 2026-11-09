<script lang="ts">
  import { Check, ChevronRight, Code, Copy, Eye, FileDiff } from "@lucide/svelte";
  import { git, type FileContent, type FileStatus } from "../api";
  import { app } from "../state.svelte";
  import { formatBytes } from "../format";
  import { isBold, isItalic, languageFor, tokenize, type ThemedToken } from "../highlight";
  import DiffView from "./DiffView.svelte";
  import ImageDiff from "./ImageDiff.svelte";
  import { isImage, worktreeImage } from "../imageDiff";
  import { settings } from "../settings.svelte";
  import FileIcon from "./FileIcon.svelte";
  import FolderIcon from "./FolderIcon.svelte";
  import Segmented from "./Segmented.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import ImagePreview from "./ImagePreview.svelte";
  import MarkdownPreview from "./MarkdownPreview.svelte";
  import PdfPreview from "./PdfPreview.svelte";

  let { path, status }: { path: string; status: FileStatus | null } = $props();

  let content = $state<FileContent | null>(null);
  let tokens = $state.raw<ThemedToken[][] | null>(null);
  let error = $state<string | null>(null);
  /** Files that can be shown rendered, not just as text. */
  const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "apng", "tif", "tiff"]);
  const ext = $derived(path.split(".").pop()!.toLowerCase());
  const previewKind = $derived<"image" | "svg" | "pdf" | "markdown" | null>(
    IMAGE_EXT.has(ext) ? "image" : ext === "svg" ? "svg" : ext === "pdf" ? "pdf" : ["md", "markdown", "mdx"].includes(ext) ? "markdown" : null,
  );

  // svelte-ignore state_referenced_locally
  let mode = $state<"preview" | "file" | "diff">(previewKind ? "preview" : "file");

  const modes = $derived.by(() => {
    const out: { value: "preview" | "file" | "diff"; label: string; icon: typeof Eye }[] = [];
    if (previewKind) out.push({ value: "preview", label: "Preview", icon: Eye });
    out.push({ value: "file", label: "Code", icon: Code });
    if (status) out.push({ value: "diff", label: "Changes", icon: FileDiff });
    return out;
  });
  let diff = $state<string | null>(null);
  let copied = $state(false);

  const segments = $derived(path.split("/"));
  const lineCount = $derived(content?.text ? content.text.split("\n").length : 0);
  const gutter = $derived(Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"));
  const language = $derived(languageFor(path));

  // Reload when the file changes on disk (refresh updates status and tree).
  $effect(() => {
    const repo = app.repo;
    void app.status;
    void app.active.tree;
    if (!repo) return;
    let cancelled = false;
    git
      .readFile(repo.path, path)
      .then(async (c) => {
        if (cancelled) return;
        content = c;
        error = null;
        // Show plain text immediately, then colour it once the grammar is ready.
        const t = c.text ? await tokenize(c.text, path) : null;
        if (!cancelled) tokens = t;
      })
      .catch((e) => !cancelled && (error = String(e)));
    return () => (cancelled = true);
  });

  $effect(() => {
    const repo = app.repo;
    if (mode !== "diff" || !repo || !status) return;
    const change = app.status.find((s) => s.path === path && !s.staged) ?? app.status.find((s) => s.path === path);
    if (!change) return;
    let cancelled = false;
    git
      .fileDiff(repo.path, path, change.staged, change.status === "untracked", settings.value.diffIgnoreWhitespace)
      .then((d) => !cancelled && (diff = d))
      .catch((e) => !cancelled && (diff = String(e)));
    return () => (cancelled = true);
  });

  $effect(() => {
    if (!status && mode === "diff") mode = previewKind ? "preview" : "file";
  });

  async function copyPath() {
    await navigator.clipboard.writeText(path);
    copied = true;
    setTimeout(() => (copied = false), 1300);
  }

  /** Breadcrumb click: open that folder (and its parents) in the tree. */
  function revealFolder(index: number) {
    for (let i = 1; i <= index + 1; i++) app.active.expanded.add(segments.slice(0, i).join("/"));
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <header class="flex h-11 shrink-0 items-center gap-2.5 border-b border-line-soft px-4">
    {#if status}<StatusBadge {status} />{/if}
    <!-- Breadcrumbs: click a folder to open it in the tree -->
    <nav class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-[13px]" aria-label="File path">
      {#each segments as seg, i (i)}
        {#if i < segments.length - 1}
          <button
            class="flex min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 py-0.5 text-fg-faint transition-colors hover:bg-surface-2 hover:text-fg-muted"
            title="Show {segments.slice(0, i + 1).join('/')} in the tree"
            onclick={() => revealFolder(i)}
          >
            <FolderIcon name={seg} size={13} />
            <span class="truncate">{seg}</span>
          </button>
          <ChevronRight size={12} class="shrink-0 text-fg-faint/60" />
        {:else}
          <span class="flex min-w-0 shrink-0 items-center gap-1.5 px-1.5">
            <FileIcon path={seg} size={14} />
            <span class="truncate font-medium text-fg">{seg}</span>
          </span>
        {/if}
      {/each}
    </nav>
    {#if language}
      <span class="hidden rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-faint lg:inline">{language}</span>
    {/if}
    {#if content}<span class="text-[11.5px] text-fg-faint tabular-nums">{formatBytes(content.size)}</span>{/if}
    {#if modes.length > 1}
      <Segmented bind:value={mode} options={modes} />
    {/if}
    <button class="icon-btn size-7" title="Copy path" onclick={copyPath}>
      {#if copied}<Check size={14} class="text-added" />{:else}<Copy size={14} />{/if}
    </button>
  </header>

  <div class="min-h-0 flex-1">
    {#if mode === "diff"}
      {@const change = app.status.find((s) => s.path === path && !s.staged) ?? app.status.find((s) => s.path === path)}
      {#if change && app.repo && isImage(path)}
        {@const img = worktreeImage(app.repo.path, change)}
        <ImageDiff {path} before={img.before} after={img.after} />
      {:else}
        <DiffView {diff} {path} loading={diff === null} />
      {/if}
    {:else if mode === "preview" && previewKind === "image"}
      <ImagePreview {path} size={content?.size ?? 0} />
    {:else if mode === "preview" && previewKind === "pdf"}
      <PdfPreview {path} />
    {:else if mode === "preview" && previewKind === "svg" && content?.text}
      <ImagePreview {path} svgText={content.text} size={content.size} />
    {:else if mode === "preview" && previewKind === "markdown" && content?.text != null}
      <MarkdownPreview text={content.text} {path} />
    {:else if error}
      <div class="flex h-full items-center justify-center px-8 text-center text-[13px] text-fg-faint">{error}</div>
    {:else if !content}
      <div class="space-y-2 p-5">
        {#each Array(14) as _, i}
          <div class="h-3 animate-pulse rounded bg-surface-2" style:width="{30 + ((i * 41) % 60)}%"></div>
        {/each}
      </div>
    {:else if content.binary}
      <div class="flex h-full items-center justify-center text-[13px] text-fg-faint">Binary file · {formatBytes(content.size)} · no preview</div>
    {:else if content.size === 0}
      <div class="flex h-full items-center justify-center text-[13px] text-fg-faint">Empty file</div>
    {:else}
      <div class="h-full overflow-auto bg-black/25">
        {#if content.truncated}
          <div class="sticky top-0 z-10 border-b border-line-soft bg-[oklch(0.08_0.012_320)] px-4 py-1.5 text-[12px] text-modified">
            Large file: showing the first {formatBytes(2 * 1024 * 1024)} of {formatBytes(content.size)}
          </div>
        {/if}
        <div class="flex min-w-max font-mono text-[12.5px] leading-[21px] tracking-normal">
          <pre class="sticky left-0 shrink-0 bg-[oklch(0.075_0.01_320)] px-3 text-right text-fg-faint/60 select-none">{gutter}</pre>
          {#if tokens}
            <pre class="selectable flex-1 pr-6 pl-4" style:color="var(--code-fg)">{#each tokens as line, i (i)}{#each line as t}<span
                    style:color={t.color}
                    class:italic={isItalic(t)}
                    class:font-semibold={isBold(t)}>{t.content}</span
                  >{/each}{"\n"}{/each}</pre>
          {:else}
            <pre class="selectable flex-1 pr-6 pl-4 text-fg-muted">{content.text}</pre>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

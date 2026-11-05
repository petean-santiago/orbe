<script lang="ts">
  import type { Snippet } from "svelte";
  import type { FileChange } from "../api";
  import { splitPath } from "../format";
  import StatusBadge from "./StatusBadge.svelte";
  import FileIcon from "./FileIcon.svelte";

  let {
    files,
    selected = null,
    onselect,
    onactivate,
    actions,
  }: {
    files: FileChange[];
    selected?: FileChange | null;
    onselect: (f: FileChange) => void;
    /** Double-click / Enter, e.g. to stage or unstage. */
    onactivate?: (f: FileChange) => void;
    actions?: Snippet<[FileChange]>;
  } = $props();

  const isSelected = (f: FileChange) =>
    !!selected && selected.path === f.path && selected.staged === f.staged;
</script>

<ul class="px-1.5" role="listbox">
  {#each files as f (f.path + f.staged)}
    {@const { dir, name } = splitPath(f.path)}
    {@const sel = isSelected(f)}
    <li>
      <div
        role="option"
        aria-selected={sel}
        class={[
          "group flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] transition-colors duration-75",
          sel ? "bg-accent-soft text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
        ]}
        title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
        onclick={() => onselect(f)}
        ondblclick={() => onactivate?.(f)}
        onkeydown={(e) => e.key === "Enter" && onactivate?.(f)}
        tabindex="0"
      >
        <StatusBadge status={f.status} />
        <FileIcon path={f.path} size={14} />
        <span class="min-w-0 flex-1 truncate">
          <span class={sel ? "text-fg" : ""}>{name}</span>
          {#if dir}<span class="ml-1.5 text-[12px] text-fg-faint">{dir}</span>{/if}
        </span>
        {#if actions}
          <span class="flex items-center opacity-0 transition-opacity group-hover:opacity-100" class:opacity-100={sel}>
            {@render actions(f)}
          </span>
        {/if}
      </div>
    </li>
  {/each}
</ul>

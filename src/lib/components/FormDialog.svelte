<script lang="ts">
  import { Check, Folder, FolderOpen, Plus } from "@lucide/svelte";
  import { fade, fly } from "svelte/transition";
  import { pickDirectory, pickFolder } from "../api";
  import { ui, type ChecklistOption, type FormField, type FormValues } from "../ui.svelte";

  const form = $derived(ui.form!);

  const initial = (f: FormField) => f.value ?? (f.kind === "checkbox" ? false : f.kind === "checklist" ? [] : "");
  // svelte-ignore state_referenced_locally
  let values = $state<FormValues>(Object.fromEntries(form.fields.map((f) => [f.key, initial(f)])));
  let touched = $state<Record<string, boolean>>({});
  let first: HTMLInputElement | HTMLTextAreaElement | undefined = $state();
  /** Folders the user browsed to, added to a checklist's choices. */
  let added = $state<Record<string, ChecklistOption[]>>({});

  function fieldError(f: FormField): string | null {
    if (f.kind === "checkbox") return null;
    if (f.kind === "checklist") {
      const n = (values[f.key] as string[]).length;
      return f.min && n < f.min ? `Pick at least ${f.min === 1 ? "one" : f.min}.` : null;
    }
    return f.validate?.(String(values[f.key] ?? ""), values) ?? null;
  }

  const errors = $derived(Object.fromEntries(form.fields.map((f) => [f.key, fieldError(f)])));

  function toggle(key: string, value: string) {
    const list = values[key] as string[];
    values[key] = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    touched[key] = true;
  }

  async function browseInto(f: FormField) {
    const dir = await pickFolder();
    if (!dir) return;
    const known = [...(f.options ?? []), ...(added[f.key] ?? [])].some((o) => o.value === dir);
    if (!known) {
      const label = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
      added[f.key] = [...(added[f.key] ?? []), { value: dir, label, hint: dir }];
    }
    if (!(values[f.key] as string[]).includes(dir)) toggle(f.key, dir);
  }
  const valid = $derived(Object.values(errors).every((e) => !e));

  $effect(() => {
    first?.focus();
    first?.select?.();
  });

  function submit(e?: Event) {
    e?.preventDefault();
    touched = Object.fromEntries(form.fields.map((f) => [f.key, true]));
    if (valid) ui.finishForm($state.snapshot(values));
  }

  async function browse(key: string, label: string) {
    const dir = await pickDirectory(label);
    if (dir) {
      values[key] = dir;
      touched[key] = true;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      ui.finishForm(null);
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      submit(e);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  role="presentation"
  class="fixed inset-0 z-50 flex items-start justify-center bg-black/45 pt-[14vh] backdrop-blur-[2px]"
  transition:fade={{ duration: 120 }}
  onclick={() => ui.finishForm(null)}
>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <form
    class="glass-strong w-[min(460px,calc(100vw-32px))] overflow-hidden rounded-2xl"
    transition:fly={{ y: 8, duration: 180 }}
    onclick={(e) => e.stopPropagation()}
    onsubmit={submit}
    aria-label={form.title}
  >
    <header class={["flex items-start gap-3.5 px-6 pt-5", !form.fields.length && "pb-5"]}>
      {#if form.icon}
        <span
          class={[
            "flex size-9 shrink-0 items-center justify-center rounded-xl border",
            form.danger ? "border-deleted/30 bg-deleted/10 text-deleted" : "border-accent/25 bg-accent-soft text-accent",
          ]}
        >
          <form.icon size={17} />
        </span>
      {/if}
      <div class="min-w-0 pt-0.5">
        <h2 class="font-display text-[19px] leading-tight text-fg">{form.title}</h2>
        {#if form.description}<p class="mt-1 text-[12.5px] leading-snug text-fg-faint">{form.description}</p>{/if}
      </div>
    </header>

    <div class={["flex flex-col gap-4 px-6 pt-5 pb-6", !form.fields.length && "hidden"]}>
      {#each form.fields as f, i (f.key)}
        {@const err = touched[f.key] ? errors[f.key] : null}
        {#if f.kind === "checkbox"}
          <label class="flex cursor-pointer items-center gap-2.5 text-[13px] text-fg-muted select-none">
            <span
              class={[
                "flex size-4.5 items-center justify-center rounded-[5px] border transition-colors",
                values[f.key] ? "border-accent bg-accent-strong" : "border-line bg-surface-2",
              ]}
            >
              {#if values[f.key]}<Check size={12} strokeWidth={3} class="text-white" />{/if}
            </span>
            <input type="checkbox" class="sr-only" bind:checked={values[f.key] as boolean} />
            {f.label}
          </label>
        {:else if f.kind === "checklist"}
          {@const options = [...(f.options ?? []), ...(added[f.key] ?? [])]}
          {@const picked = values[f.key] as string[]}
          <div class="flex flex-col gap-1.5">
            <div class="flex items-baseline justify-between">
              <span class="text-[12px] font-medium text-fg-muted">{f.label}</span>
              <span class="text-[11.5px] text-fg-faint tabular-nums">{picked.length} selected</span>
            </div>
            <div class={["glass-well flex max-h-[260px] flex-col overflow-y-auto rounded-lg p-1", err && "border-deleted/60"]}>
              {#each options as o (o.value)}
                {@const on = picked.includes(o.value)}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  class={[
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                    on ? "bg-accent-soft" : "hover:bg-surface-2",
                  ]}
                  onclick={() => toggle(f.key, o.value)}
                >
                  <span
                    class={[
                      "flex size-4.5 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                      on ? "border-accent bg-accent-strong" : "border-line bg-surface-2",
                    ]}
                  >
                    {#if on}<Check size={12} strokeWidth={3} class="text-white" />{/if}
                  </span>
                  <Folder size={14} class={on ? "shrink-0 text-accent" : "shrink-0 text-fg-faint"} />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[13px] text-fg">{o.label}</span>
                    {#if o.hint}<span class="block truncate font-mono text-[10.5px] text-fg-faint">{o.hint}</span>{/if}
                  </span>
                </button>
              {:else}
                <p class="px-2 py-3 text-center text-[12px] text-fg-faint">No repositories yet. Browse for one below.</p>
              {/each}
              {#if f.browse}
                <button
                  type="button"
                  class="mt-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                  onclick={() => browseInto(f)}
                >
                  <Plus size={14} class="text-accent" /> Add another folder…
                </button>
              {/if}
            </div>
            {#if err}
              <span class="text-[12px] text-deleted" transition:fade={{ duration: 100 }}>{err}</span>
            {:else if f.hint}
              <span class="text-[12px] text-fg-faint">{f.hint}</span>
            {/if}
          </div>
        {:else}
          <label class="flex flex-col gap-1.5">
            <span class="text-[12px] font-medium text-fg-muted">{f.label}</span>
            <div
              class={[
                "glass-well flex items-center rounded-lg transition-[border-color,box-shadow]",
                err ? "border-deleted/60" : "focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_var(--color-accent-soft)]",
              ]}
            >
              {#if f.kind === "textarea"}
                <textarea
                  bind:value={values[f.key] as string}
                  placeholder={f.placeholder}
                  rows="3"
                  class="block w-full resize-none bg-transparent px-3 py-2 text-[13px] text-fg outline-none placeholder:text-fg-faint"
                ></textarea>
              {:else if i === 0}
                <input
                  bind:this={first}
                  bind:value={values[f.key] as string}
                  placeholder={f.placeholder}
                  spellcheck="false"
                  autocomplete="off"
                  oninput={() => (touched[f.key] = true)}
                  class={["h-9 w-full bg-transparent px-3 text-[13px] text-fg outline-none placeholder:text-fg-faint", f.mono && "font-mono text-[12.5px]"]}
                />
              {:else}
                <input
                  bind:value={values[f.key] as string}
                  placeholder={f.placeholder}
                  spellcheck="false"
                  autocomplete="off"
                  oninput={() => (touched[f.key] = true)}
                  class={["h-9 w-full bg-transparent px-3 text-[13px] text-fg outline-none placeholder:text-fg-faint", f.mono && "font-mono text-[12.5px]"]}
                />
              {/if}
              {#if f.kind === "folder"}
                <button type="button" class="btn mr-1 h-7 shrink-0 px-2.5 text-[12px]" onclick={() => browse(f.key, f.label)}>
                  <FolderOpen size={13} /> Browse
                </button>
              {/if}
            </div>
            {#if err}
              <span class="text-[12px] text-deleted" transition:fade={{ duration: 100 }}>{err}</span>
            {:else if f.hint}
              <span class="text-[12px] text-fg-faint">{f.hint}</span>
            {/if}
          </label>
        {/if}
      {/each}
    </div>

    <footer class="flex items-center justify-end gap-2 border-t border-line-soft bg-black/20 px-6 py-3.5">
      <button type="button" class="btn h-8 px-3.5" onclick={() => ui.finishForm(null)}>Cancel</button>
      <button
        type="submit"
        class={["btn-primary h-8 px-4", form.danger && "!bg-deleted/80 !shadow-none hover:!bg-deleted"]}
        disabled={!valid && Object.keys(touched).length > 0}
      >
        {form.confirm}
      </button>
    </footer>
  </form>
</div>

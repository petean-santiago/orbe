<script lang="ts">
  import { Check, FolderOpen } from "@lucide/svelte";
  import { fade, fly } from "svelte/transition";
  import { pickDirectory } from "../api";
  import { ui, type FormValues } from "../ui.svelte";

  const form = $derived(ui.form!);

  // svelte-ignore state_referenced_locally
  let values = $state<FormValues>(Object.fromEntries(form.fields.map((f) => [f.key, f.value ?? (f.kind === "checkbox" ? false : "")])));
  let touched = $state<Record<string, boolean>>({});
  let first: HTMLInputElement | HTMLTextAreaElement | undefined = $state();

  const errors = $derived(
    Object.fromEntries(
      form.fields.map((f) => [f.key, f.kind === "checkbox" ? null : (f.validate?.(String(values[f.key] ?? ""), values) ?? null)]),
    ),
  );
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
    <header class="flex items-start gap-3.5 px-6 pt-5">
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

    <div class="flex flex-col gap-4 px-6 pt-5 pb-6">
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

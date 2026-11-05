<script lang="ts">
  import {
    ArrowUp,
    ChevronDown,
    FileSearch,
    GitCommitHorizontal,
    ListChecks,
    MessageSquare,
    PanelRightClose,
    Settings2,
    Sparkles,
    SquarePen,
    Trash2,
    X,
  } from "@lucide/svelte";
  import { fade } from "svelte/transition";
  import { confirmAction } from "../api";
  import { relativeTime } from "../format";
  import { fly } from "svelte/transition";
  import { app } from "../state.svelte";
  import { ui } from "../ui.svelte";
  import { aiReady, explainCommit, newChat, providerLabel, reviewStaged, send, summarizeChanges } from "../assistant.svelte";
  import Markdown from "./Markdown.svelte";
  import { settings } from "../settings.svelte";

  /** Floating: drawn over the content (narrow windows) instead of beside it. */
  let { floating = false }: { floating?: boolean } = $props();
  const fromLeft = $derived(settings.value.sidebarSide === "right");

  const tab = $derived(app.active);
  let draft = $state("");
  let scroller: HTMLDivElement | undefined = $state();
  let input: HTMLTextAreaElement | undefined = $state();
  /** Showing the list of saved conversations instead of the open one. */
  let showList = $state(false);

  function startNew() {
    newChat(tab);
    showList = false;
    draft = "";
    queueMicrotask(() => input?.focus());
  }

  function open(id: string) {
    tab.openChat(id);
    showList = false;
  }

  async function closeConversation(id: string, title: string) {
    const ok = await confirmAction(`Close "${title}"? The conversation will be deleted.`, "Close conversation", "Close");
    if (ok) tab.closeChat(id);
  }

  const suggestions = $derived([
    { label: "Summarize my changes", icon: FileSearch, run: () => summarizeChanges(tab), show: app.status.length > 0 },
    { label: "Review staged changes", icon: ListChecks, run: () => reviewStaged(tab), show: app.staged.length > 0 },
    {
      label: "Explain the selected commit",
      icon: GitCommitHorizontal,
      run: () => app.selectedCommit && explainCommit(tab, app.selectedCommit),
      show: !!app.selectedCommit,
    },
    { label: "What should I do next?", icon: Sparkles, run: () => send(tab, "Looking at the state of this repository, what should I do next?"), show: true },
  ]);

  // Stick to the newest message.
  $effect(() => {
    void tab.chat.length;
    void tab.chatBusy;
    queueMicrotask(() => scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" }));
  });

  $effect(() => {
    if (aiReady()) input?.focus();
  });

  function submit() {
    const text = draft.trim();
    if (!text || tab.chatBusy) return;
    draft = "";
    send(tab, text);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function openSettings() {
    ui.settingsPage = "ai";
    app.settingsOpen = true;
  }
</script>

<svelte:window onkeydown={(e) => floating && e.key === "Escape" && !e.defaultPrevented && (ui.assistant = false)} />

<aside
  class={[
    "flex flex-col overflow-hidden rounded-2xl",
    floating
      ? ["glass-strong absolute top-0 bottom-2 z-30 shadow-[0_24px_80px_-12px_rgb(0_0_0/0.8)]", fromLeft ? "left-2" : "right-2"]
      : "glass shrink-0",
  ]}
  style:width={floating
    ? `min(${settings.value.sizes.assistant}px, calc(100% - 24px))`
    : `min(${settings.value.sizes.assistant}px, 45vw)`}
  transition:fly={{ x: fromLeft ? -16 : 16, duration: 180 }}
>
  <header class="flex h-12 shrink-0 items-center gap-2.5 border-b border-line-soft pr-2 pl-4">
    <span class="flex size-7 items-center justify-center rounded-lg bg-accent-soft text-accent shadow-[0_0_18px_-4px_var(--color-accent-glow)]">
      <Sparkles size={15} />
    </span>
    <div class="min-w-0 flex-1 leading-tight">
      <button
        class="flex max-w-full items-center gap-1 text-[13.5px] font-semibold text-fg hover:text-accent-fg"
        title="Your conversations"
        onclick={() => (showList = !showList)}
      >
        <span class="truncate">{showList ? "Conversations" : (tab.activeChat?.title ?? "New chat")}</span>
        <ChevronDown size={13} class={["shrink-0 opacity-60 transition-transform", showList && "rotate-180"]} />
      </button>
      <button class="max-w-full truncate text-[11.5px] text-fg-faint hover:text-fg-muted" onclick={openSettings} title="Change provider">
        {providerLabel()}
      </button>
    </div>
    <button class="icon-btn size-7" title="New chat" onclick={startNew}><SquarePen size={14} /></button>
    {#if tab.activeChat && !showList}
      <button class="icon-btn size-7" title="Close this conversation" onclick={() => closeConversation(tab.activeChat!.id, tab.activeChat!.title)}>
        <X size={15} />
      </button>
    {/if}
    <button class="icon-btn size-7" title="Hide panel (your conversation is kept)" onclick={() => (ui.assistant = false)}><PanelRightClose size={15} /></button>
  </header>

  {#if !aiReady()}
    <div class="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <div class="flex size-14 items-center justify-center rounded-2xl border border-accent/20 bg-accent-soft text-accent shadow-[0_0_40px_-8px_var(--color-accent-glow)]">
        <Sparkles size={22} />
      </div>
      <div>
        <p class="font-display text-[19px] text-fg">Bring your own AI</p>
        <p class="mt-1.5 text-[12.5px] leading-relaxed text-fg-faint">
          Use the Claude API, OpenAI, a local model, or your existing Claude or ChatGPT plan through Claude Code or Codex.
        </p>
      </div>
      <button class="btn-primary h-9 px-4" onclick={openSettings}><Settings2 size={14} /> Set up AI</button>
    </div>
  {:else if showList}
    <div class="min-h-0 flex-1 overflow-y-auto p-2" in:fade={{ duration: 120 }}>
      <button
        class="mb-1 flex w-full items-center gap-2.5 rounded-xl border border-dashed border-accent/30 px-3 py-2.5 text-left text-[13px] text-accent-fg transition-colors hover:border-accent/60 hover:bg-accent-soft"
        onclick={startNew}
      >
        <SquarePen size={15} /> New chat
      </button>
      {#each tab.sortedChats as c (c.id)}
        {@const active = c.id === tab.activeChatId}
        {@const n = c.turns.filter((t) => t.role === "user").length}
        <div
          class={[
            "group flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors",
            active ? "bg-accent-soft" : "hover:bg-surface-2",
          ]}
        >
          <MessageSquare size={14} class={["shrink-0", active ? "text-accent" : "text-fg-faint"]} />
          <button class="min-w-0 flex-1 text-left" onclick={() => open(c.id)}>
            <span class={["block truncate text-[13px]", active ? "font-medium text-fg" : "text-fg-muted"]}>{c.title}</span>
            <span class="block text-[11.5px] text-fg-faint">
              {relativeTime(Math.floor(c.updatedAt / 1000))} · {n} message{n === 1 ? "" : "s"}
              {#if tab.busyChats.has(c.id)}· replying…{/if}
            </span>
          </button>
          <button
            class="icon-btn size-7 shrink-0 opacity-0 group-hover:opacity-100 hover:!text-deleted"
            title="Close conversation"
            onclick={() => closeConversation(c.id, c.title)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      {:else}
        <p class="px-3 py-6 text-center text-[12.5px] text-fg-faint">No conversations yet. They're saved here as you chat.</p>
      {/each}
    </div>
  {:else}
    <div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {#if tab.chat.length === 0}
        <div class="flex flex-col gap-2 pt-2">
          <p class="mb-1 text-[12.5px] text-fg-faint">Ask anything about <span class="text-fg-muted">{app.repo?.name}</span>, or start with:</p>
          {#each suggestions.filter((s) => s.show) as s (s.label)}
            <button
              class="flex items-center gap-2.5 rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5 text-left text-[13px] text-fg-muted transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-fg"
              onclick={s.run}
            >
              <s.icon size={15} class="shrink-0 text-accent" />
              {s.label}
            </button>
          {/each}
        </div>
      {/if}

      <div class="flex flex-col gap-4">
        {#each tab.chat as turn, i (i)}
          {#if turn.role === "user"}
            <div class="ml-8 self-end rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[13px] whitespace-pre-wrap text-fg selectable">
              {turn.display ?? turn.content}
            </div>
          {:else if turn.error}
            <div class="rounded-xl border border-deleted/30 bg-deleted/10 px-3.5 py-2.5 text-[12.5px] text-deleted selectable">{turn.content}</div>
          {:else}
            <div class="animate-fade-in"><Markdown text={turn.content} /></div>
          {/if}
        {/each}
        {#if tab.chatBusy}
          <div class="flex items-center gap-1.5 py-1" aria-label="Thinking">
            {#each [0, 1, 2] as d}
              <span class="size-1.5 animate-bounce rounded-full bg-accent" style:animation-delay="{d * 140}ms"></span>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="shrink-0 border-t border-line-soft p-3">
      <div class="glass-well flex items-end gap-2 rounded-xl p-1.5 pl-3 transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_var(--color-accent-soft)]">
        <textarea
          bind:this={input}
          bind:value={draft}
          onkeydown={onKey}
          rows="1"
          placeholder="Ask about this repository…"
          class="max-h-40 min-h-[30px] flex-1 resize-none bg-transparent py-1.5 text-[13px] text-fg outline-none [field-sizing:content] placeholder:text-fg-faint"
        ></textarea>
        <button class="btn-primary size-8 shrink-0 justify-center p-0" disabled={!draft.trim() || tab.chatBusy} onclick={submit} aria-label="Send">
          <ArrowUp size={15} />
        </button>
      </div>
      <p class="mt-1.5 px-1 text-[11px] text-fg-faint">Enter to send · Shift+Enter for a new line · replies can be wrong</p>
    </div>
  {/if}
</aside>

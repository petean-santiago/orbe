<script lang="ts">
  import {
    Check,
    CircleAlert,
    CircleCheck,
    KeyRound,
    LoaderCircle,
    Power,
    RefreshCw,
    Server,
    ShieldCheck,
    Terminal,
    Zap,
  } from "@lucide/svelte";
  import { ai, type AiProvider } from "../api";
  import { settings, AI_PROVIDERS } from "../settings.svelte";

  const s = $derived(settings.value.ai);
  const provider = $derived(s.provider);
  const meta = $derived(provider === "none" ? null : AI_PROVIDERS[provider]);

  let hasKey = $state<boolean | null>(null);
  let keyDraft = $state("");
  let replacing = $state(false);
  let savingKey = $state(false);
  let cliVersion = $state<string | null | undefined>(undefined);
  let models = $state<string[]>([]);
  let loadingModels = $state(false);
  let test = $state<{ state: "idle" | "running" | "ok" | "error"; message?: string }>({ state: "idle" });
  let error = $state<string | null>(null);

  const needsKey = $derived(provider === "anthropic" || provider === "openai" || provider === "compatible");

  // Refresh provider status when the provider changes.
  $effect(() => {
    const p = provider;
    hasKey = null;
    cliVersion = undefined;
    models = [];
    replacing = false;
    keyDraft = "";
    test = { state: "idle" };
    error = null;
    if (p === "anthropic" || p === "openai" || p === "compatible") ai.hasKey(p).then((v) => provider === p && (hasKey = v));
    if (p === "claude-code" || p === "codex") ai.cliVersion(p).then((v) => provider === p && (cliVersion = v));
  });

  function choose(p: AiProvider) {
    settings.value.ai.provider = p;
  }

  async function saveKey() {
    if (!keyDraft.trim() || provider === "none") return;
    savingKey = true;
    error = null;
    try {
      await ai.setKey(provider, keyDraft.trim());
      hasKey = true;
      replacing = false;
      keyDraft = "";
      if (provider !== "compatible") loadModels();
    } catch (e) {
      error = String(e);
    } finally {
      savingKey = false;
    }
  }

  async function removeKey() {
    if (provider === "none") return;
    await ai.clearKey(provider);
    hasKey = false;
  }

  async function loadModels() {
    loadingModels = true;
    error = null;
    try {
      models = await ai.listModels(settings.aiConfig);
      if (!models.length) error = "The provider didn't return any models.";
    } catch (e) {
      error = String(e);
    } finally {
      loadingModels = false;
    }
  }

  async function runTest() {
    test = { state: "running" };
    const started = performance.now();
    try {
      const reply = await ai.complete(
        settings.aiConfig,
        "You are a connection test. Reply with exactly the word OK.",
        [{ role: "user", content: "Connection test" }],
        "low",
        null,
      );
      const ms = Math.round(performance.now() - started);
      test = { state: "ok", message: `Connected in ${(ms / 1000).toFixed(1)}s: “${reply.trim().slice(0, 60)}”` };
    } catch (e) {
      test = { state: "error", message: String(e) };
    }
  }

  const PRESETS = [
    { label: "Ollama", url: "http://localhost:11434/v1" },
    { label: "LM Studio", url: "http://localhost:1234/v1" },
    { label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  ];

  const KEY_HELP: Partial<Record<AiProvider, string>> = {
    anthropic: "Create one at console.anthropic.com → API keys.",
    openai: "Create one at platform.openai.com → API keys.",
    compatible: "Only needed for hosted services like OpenRouter. Local servers don't need a key.",
  };

  const CLI_HELP: Partial<Record<AiProvider, { install: string; login: string }>> = {
    "claude-code": { install: "npm install -g @anthropic-ai/claude-code", login: "claude" },
    codex: { install: "npm install -g @openai/codex", login: "codex login" },
  };

  const kindIcon = { api: KeyRound, cli: Terminal, local: Server } as const;
</script>

<div class="grid grid-cols-3 gap-2.5 @max-[640px]:grid-cols-2">
  <button
    class={[
      "flex flex-col items-start gap-2 rounded-xl border p-3.5 text-left transition-all",
      provider === "none" ? "border-accent/60 bg-accent-soft" : "border-line-soft bg-surface-1 hover:border-line hover:bg-surface-2",
    ]}
    onclick={() => choose("none")}
  >
    <Power size={17} class={provider === "none" ? "text-accent" : "text-fg-faint"} />
    <span>
      <span class="block text-[13.5px] font-medium text-fg">Off</span>
      <span class="block text-[12px] text-fg-faint">No AI features</span>
    </span>
  </button>
  {#each Object.entries(AI_PROVIDERS) as [id, p] (id)}
    {@const active = provider === id}
    {@const Icon = kindIcon[p.kind]}
    <button
      class={[
        "relative flex flex-col items-start gap-2 rounded-xl border p-3.5 text-left transition-all",
        active ? "border-accent/60 bg-accent-soft" : "border-line-soft bg-surface-1 hover:border-line hover:bg-surface-2",
      ]}
      onclick={() => choose(id as AiProvider)}
    >
      {#if active}
        <span class="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-accent-strong">
          <Check size={12} strokeWidth={3} class="text-white" />
        </span>
      {/if}
      <Icon size={17} class={active ? "text-accent" : "text-fg-faint"} />
      <span>
        <span class="block text-[13.5px] font-medium text-fg">{p.label}</span>
        <span class="block text-[12px] text-fg-faint">{p.note}</span>
      </span>
    </button>
  {/each}
</div>

{#if meta}
  <div class="mt-6 flex flex-col gap-5">
    {#if provider === "compatible"}
      <div>
        <div class="mb-1.5 text-[13px] font-medium text-fg">Server address</div>
        <div class="glass-well flex h-9 items-center rounded-lg px-3 focus-within:border-accent/60">
          <input bind:value={settings.value.ai.baseUrl} spellcheck="false" class="w-full bg-transparent font-mono text-[12.5px] text-fg outline-none" />
        </div>
        <div class="mt-2 flex gap-1.5">
          {#each PRESETS as preset (preset.label)}
            <button
              class={["rounded-full border px-2.5 py-0.5 text-[12px] transition-colors", s.baseUrl === preset.url ? "border-accent/50 bg-accent-soft text-fg" : "border-line text-fg-faint hover:text-fg-muted"]}
              onclick={() => (settings.value.ai.baseUrl = preset.url)}
            >
              {preset.label}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if needsKey}
      <div>
        <div class="mb-1.5 text-[13px] font-medium text-fg">API key{provider === "compatible" ? " (optional)" : ""}</div>
        {#if hasKey && !replacing}
          <div class="flex items-center gap-2.5 rounded-lg border border-added/25 bg-added/10 px-3 py-2">
            <ShieldCheck size={15} class="text-added" />
            <span class="flex-1 text-[12.5px] text-fg-muted">Saved in your system keychain</span>
            <button class="btn h-7 px-2.5 text-[12px]" onclick={() => (replacing = true)}>Replace</button>
            <button class="btn h-7 px-2.5 text-[12px]" onclick={removeKey}>Remove</button>
          </div>
        {:else}
          <div class="flex gap-2">
            <div class="glass-well flex h-9 flex-1 items-center rounded-lg px-3 focus-within:border-accent/60">
              <input
                type="password"
                bind:value={keyDraft}
                placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"}
                spellcheck="false"
                autocomplete="off"
                class="w-full bg-transparent font-mono text-[12.5px] text-fg outline-none placeholder:text-fg-faint"
                onkeydown={(e) => e.key === "Enter" && saveKey()}
              />
            </div>
            <button class="btn-primary h-9 px-4" disabled={!keyDraft.trim() || savingKey} onclick={saveKey}>
              {#if savingKey}<LoaderCircle size={14} class="animate-spin" />{/if} Save
            </button>
          </div>
        {/if}
        <p class="mt-1.5 text-[12px] text-fg-faint">
          {KEY_HELP[provider]} The key is stored by your operating system, never in Orbe's settings.
        </p>
      </div>
    {/if}

    {#if meta.kind === "cli"}
      {@const help = CLI_HELP[provider]}
      <div class="rounded-xl border border-line-soft bg-surface-1 px-4 py-3">
        <div class="flex items-center gap-2 text-[13px]">
          {#if cliVersion === undefined}
            <LoaderCircle size={14} class="animate-spin text-fg-faint" /> <span class="text-fg-muted">Looking for {meta.label}…</span>
          {:else if cliVersion}
            <CircleCheck size={15} class="text-added" /> <span class="text-fg-muted">Found {meta.label} <span class="font-mono text-[12px] text-fg-faint">{cliVersion}</span></span>
          {:else}
            <CircleAlert size={15} class="text-modified" /> <span class="text-fg-muted">{meta.label} wasn't found on this computer.</span>
          {/if}
        </div>
        {#if help}
          <p class="mt-2 text-[12px] leading-relaxed text-fg-faint">
            Install it with <code class="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11.5px] text-accent-fg">{help.install}</code>, then run
            <code class="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11.5px] text-accent-fg">{help.login}</code> once in a terminal to sign in.
            Orbe runs it in read-only mode and your plan's usage limits apply.
          </p>
        {/if}
      </div>
    {/if}

    <div>
      <div class="mb-1.5 flex items-center justify-between">
        <span class="text-[13px] font-medium text-fg">Model</span>
        {#if meta.kind !== "cli"}
          <button class="btn h-7 px-2.5 text-[12px]" onclick={loadModels} disabled={loadingModels}>
            {#if loadingModels}<LoaderCircle size={12} class="animate-spin" />{:else}<RefreshCw size={12} />{/if}
            Load models
          </button>
        {/if}
      </div>
      <div class="glass-well flex h-9 items-center rounded-lg px-3 focus-within:border-accent/60">
        <input
          bind:value={settings.value.ai.models[provider]}
          list="orbe-models"
          spellcheck="false"
          placeholder={meta.defaultModel || (meta.kind === "cli" ? "Default model of the CLI" : "Choose or type a model id")}
          class="w-full bg-transparent font-mono text-[12.5px] text-fg outline-none placeholder:text-fg-faint"
        />
        <datalist id="orbe-models">
          {#each [...new Set([...meta.suggestions, ...models])] as m}<option value={m}></option>{/each}
        </datalist>
      </div>
      {#if models.length || meta.suggestions.length}
        <div class="mt-2 flex flex-wrap gap-1.5">
          {#each [...new Set([...meta.suggestions, ...models])].slice(0, 12) as m (m)}
            {@const current = settings.aiConfig.model === m}
            <button
              class={["rounded-full border px-2.5 py-0.5 font-mono text-[11.5px] transition-colors", current ? "border-accent/50 bg-accent-soft text-fg" : "border-line text-fg-faint hover:text-fg-muted"]}
              onclick={() => (settings.value.ai.models[provider] = m)}
            >
              {m}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if error}
      <p class="rounded-lg border border-deleted/30 bg-deleted/10 px-3 py-2 text-[12.5px] text-deleted">{error}</p>
    {/if}

    <div class="flex items-center gap-3 border-t border-line-soft pt-5">
      <button class="btn h-9 px-4" onclick={runTest} disabled={test.state === "running"}>
        {#if test.state === "running"}<LoaderCircle size={14} class="animate-spin" />{:else}<Zap size={14} />{/if}
        Test connection
      </button>
      {#if test.state === "ok"}
        <span class="flex min-w-0 items-center gap-1.5 text-[12.5px] text-added"><CircleCheck size={14} class="shrink-0" /><span class="truncate">{test.message}</span></span>
      {:else if test.state === "error"}
        <span class="min-w-0 text-[12.5px] text-deleted">{test.message}</span>
      {/if}
    </div>

    <p class="text-[12px] leading-relaxed text-fg-faint">
      Orbe only contacts the provider when you ask it to (generate a message, explain, chat). It sends the relevant
      diffs, file names and recent commit messages, nothing else.
    </p>
  </div>
{/if}

<script lang="ts">
  /**
   * Step-by-step help when a fetch, pull or push didn't go through: SSO
   * authorization, sign-in, the remote being ahead, a refused push. Opens the
   * right page in the browser and retries from here.
   */
  import { Check, Copy, ExternalLink, Globe, KeyRound, LoaderCircle, RotateCw, ShieldAlert, TriangleAlert, X } from "@lucide/svelte";
  import { fade, fly } from "svelte/transition";
  import { openUrl } from "../api";
  import { app } from "../state.svelte";
  import { remoteIssueText } from "../remoteIssue";

  const tab = $derived(app.active);
  const issue = $derived(tab.remoteIssue!);
  const error = $derived(issue.error);
  const text = $derived(remoteIssueText(issue, tab.headBranch?.name ?? null));
  const host = $derived(error.host);
  const github = $derived(host === "github.com");
  const ssh = $derived(/publickey|ssh key|git@/i.test(error.message));
  const busy = $derived(!!tab.remoteOp);
  const command = $derived(`cd "${tab.repo?.path ?? "."}" && git ${issue.op}`);

  let copied = $state<string | null>(null);

  function close() {
    tab.remoteIssueOpen = false;
  }

  async function copy(value: string, key: string) {
    await navigator.clipboard.writeText(value);
    copied = key;
    setTimeout(() => copied === key && (copied = null), 1500);
  }

  function open(url: string) {
    openUrl(url).catch((e) => app.toast("error", "Couldn't open the browser", String(e)));
  }

  async function retry() {
    if (error.kind === "behind") await tab.pullThenPush();
    else await tab.remote(issue.op);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#snippet step(n: number, body: import("svelte").Snippet)}
  <li class="flex gap-3">
    <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">{n}</span>
    <div class="min-w-0 flex-1 pt-0.5">{@render body()}</div>
  </li>
{/snippet}

{#snippet code(value: string, key: string)}
  <div class="mt-2 flex items-center gap-2 rounded-lg border border-line-soft bg-black/30 py-1.5 pr-1.5 pl-3">
    <code class="selectable min-w-0 flex-1 truncate font-mono text-[12px] text-fg">{value}</code>
    <button class="icon-btn size-7 shrink-0" title="Copy" onclick={() => copy(value, key)}>
      {#if copied === key}<Check size={13} class="text-added" />{:else}<Copy size={13} />{/if}
    </button>
  </div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div role="presentation" class="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-6" transition:fade={{ duration: 140 }} onclick={close}>
  <div
    role="dialog"
    aria-modal="true"
    aria-label={text.heading}
    tabindex="-1"
    class="glass-strong flex max-h-full w-[min(560px,100%)] flex-col overflow-hidden rounded-2xl"
    transition:fly={{ y: 10, duration: 200 }}
    onclick={(e) => e.stopPropagation()}
  >
    <header class="flex items-start gap-3 border-b border-line-soft px-6 py-5">
      <span
        class={[
          "flex size-10 shrink-0 items-center justify-center rounded-xl border",
          error.kind === "sso" || error.kind === "auth" ? "border-conflict/30 bg-conflict/12 text-conflict" : "border-modified/30 bg-modified/12 text-modified",
        ]}
      >
        {#if error.kind === "sso"}<ShieldAlert size={19} />{:else if error.kind === "auth"}<KeyRound size={19} />{:else if error.kind === "network"}<Globe size={19} />{:else}<TriangleAlert size={19} />{/if}
      </span>
      <div class="min-w-0 flex-1">
        <h2 class="font-display text-[19px] leading-tight text-fg">{text.heading}</h2>
        <p class="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{text.lead}</p>
      </div>
      <button class="icon-btn size-8 shrink-0 rounded-lg" aria-label="Close" onclick={close}><X size={16} /></button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-[13px] leading-relaxed text-fg-muted">
      {#if error.kind === "sso"}
        <ol class="space-y-4">
          {#snippet s1()}
            <p>Open the authorization page and sign in with your company account.</p>
            <button class="btn-ghost mt-2" onclick={() => open(error.url ?? `https://${host ?? "github.com"}`)}>
              <ExternalLink size={14} />
              {error.url ? "Open authorization page" : `Open ${host ?? "the remote"}`}
            </button>
          {/snippet}
          {@render step(1, s1)}
          {#snippet s2()}
            <p>Approve access for Git when your organization asks.</p>
            {#if github}
              <p class="mt-1 text-[12.5px] text-fg-faint">
                {#if ssh}Using an SSH key? Open your <button class="text-accent hover:underline" onclick={() => open("https://github.com/settings/keys")}>SSH keys</button> and choose <em>Configure SSO</em> next to it.
                {:else}Using a token? Open your <button class="text-accent hover:underline" onclick={() => open("https://github.com/settings/tokens")}>tokens</button> and choose <em>Configure SSO</em> next to it.{/if}
              </p>
            {/if}
          {/snippet}
          {@render step(2, s2)}
          {#snippet s3()}
            <p>Come back and try again.</p>
          {/snippet}
          {@render step(3, s3)}
        </ol>
      {:else if error.kind === "auth"}
        <p>Orbe uses your computer's Git sign-in (Git Credential Manager, the GitHub CLI or your SSH keys), the same one your terminal uses.</p>
        <ol class="mt-4 space-y-4">
          {#snippet a1()}
            <p>Sign in once from a terminal. Git will ask for your credentials or open your browser:</p>
            {@render code(command, "cmd")}
            {#if ssh && host}
              <p class="mt-3 text-[12.5px] text-fg-faint">Using SSH? Check that your key is loaded and accepted:</p>
              {@render code(`ssh-add -l && ssh -T git@${host}`, "ssh")}
            {/if}
          {/snippet}
          {@render step(1, a1)}
          {#snippet a2()}
            <p>Come back and try again.</p>
          {/snippet}
          {@render step(2, a2)}
        </ol>
      {:else if error.kind === "rejected" && host}
        <button class="btn-ghost" onclick={() => open(error.url ?? `https://${host}`)}><ExternalLink size={14} /> Open {host}</button>
      {/if}

      <details class="mt-5 rounded-lg border border-line-soft bg-black/20" open={error.kind === "other" || error.kind === "rejected"}>
        <summary class="flex cursor-pointer items-center justify-between px-3 py-2 text-[12px] text-fg-faint select-none hover:text-fg-muted">
          Git's message
          <button class="icon-btn size-6" title="Copy" onclick={(e) => (e.preventDefault(), copy(error.message, "msg"))}>
            {#if copied === "msg"}<Check size={12} class="text-added" />{:else}<Copy size={12} />{/if}
          </button>
        </summary>
        <pre class="selectable max-h-48 overflow-auto border-t border-line-soft px-3 py-2 font-mono text-[11.5px] leading-[18px] whitespace-pre-wrap text-fg-muted">{error.message}</pre>
      </details>
    </div>

    <footer class="flex items-center justify-end gap-2 border-t border-line-soft px-6 py-4">
      <button class="btn h-9 px-3" onclick={() => tab.dismissRemoteIssue()}>Dismiss</button>
      <button class="btn-primary h-9" disabled={busy} onclick={retry}>
        {#if busy}<LoaderCircle size={14} class="animate-spin" />{:else}<RotateCw size={14} />{/if}
        {error.kind === "behind" ? "Pull, then push" : `Retry ${issue.op}`}
      </button>
    </footer>
  </div>
</div>

<script lang="ts">
  /**
   * Step-by-step help when a fetch, pull or push didn't go through: SSO
   * authorization, sign-in, the remote being ahead, a refused push.
   *
   * Sign-in happens inside Orbe: authorization pages open in an in-app window
   * that's watched until the remote accepts us, then the operation retries by
   * itself. HTTPS remotes can also take a pasted token.
   */
  import {
    AppWindow,
    Check,
    ChevronRight,
    Copy,
    ExternalLink,
    Globe,
    KeyRound,
    LoaderCircle,
    LogIn,
    RotateCw,
    ShieldAlert,
    TriangleAlert,
    X,
  } from "@lucide/svelte";
  import { fade, fly, slide } from "svelte/transition";
  import { openUrl } from "../api";
  import { app } from "../state.svelte";
  import { remoteIssueText } from "../remoteIssue";
  import { signIn } from "../signIn.svelte";

  const tab = $derived(app.active);
  const issue = $derived(tab.remoteIssue!);
  const error = $derived(issue.error);
  const text = $derived(remoteIssueText(issue, tab.headBranch?.name ?? null));
  const host = $derived(error.host);
  const github = $derived(host === "github.com");
  const gitlab = $derived(!!host && /(^|\.)gitlab\./i.test(host));
  const ssh = $derived(error.transport === "ssh" || (error.transport !== "https" && /publickey|ssh key|git@/i.test(error.message)));
  const busy = $derived(!!tab.remoteOp);
  const command = $derived(`cd "${tab.repo?.path ?? "."}" && git ${issue.op}`);
  const waiting = $derived(signIn.status === "waiting" && signIn.isFor(tab));

  /** Where to create a token that works as a Git password, per host. */
  const tokenPage = $derived(
    github
      ? "https://github.com/settings/tokens/new?scopes=repo,workflow&description=Orbe"
      : gitlab
        ? `https://${host}/-/user_settings/personal_access_tokens?name=Orbe&scopes=read_repository,write_repository`
        : host === "bitbucket.org"
          ? "https://id.atlassian.com/manage-profile/security/api-tokens"
          : null,
  );
  const signInPage = $derived(host ? (github ? "https://github.com/login" : `https://${host}`) : null);

  let copied = $state<string | null>(null);
  let username = $state("");
  let secret = $state("");
  let showTerminal = $state(false);

  function close() {
    tab.remoteIssueOpen = false;
  }

  async function copy(value: string, key: string) {
    await navigator.clipboard.writeText(value);
    copied = key;
    setTimeout(() => copied === key && (copied = null), 1500);
  }

  /** Open a page inside Orbe and watch for the remote to accept us. */
  function openHere(url: string, title: string) {
    void signIn.show(tab, issue.op, url, title);
  }

  function openOutside(url: string) {
    openUrl(url).catch((e) => app.toast("error", "Couldn't open the browser", String(e)));
  }

  async function saveToken(e: SubmitEvent) {
    e.preventDefault();
    if (await signIn.saveCredential(tab, issue.op, username, secret)) secret = "";
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

<!-- The live "finish signing in" card, shown while the in-app window is open. -->
{#snippet watching()}
  {#if waiting}
    <div class="mt-4 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-3.5 py-3" transition:slide={{ duration: 160 }}>
      <LoaderCircle size={16} class="shrink-0 animate-spin text-accent" />
      <div class="min-w-0 flex-1 text-[12.5px] leading-snug">
        <div class="font-semibold text-fg">Finish signing in in the Orbe window</div>
        <div class="text-fg-muted">
          {signIn.checking ? "Checking with the remote…" : `Orbe will ${issue.op} again by itself as soon as ${host ?? "the remote"} lets you in.`}
        </div>
      </div>
      <button class="btn h-7 shrink-0 px-2.5 text-[12px]" onclick={() => signIn.focus()}><AppWindow size={13} /> Show</button>
      <button class="icon-btn size-7 shrink-0" title="Stop waiting" onclick={() => signIn.cancel()}><X size={14} /></button>
    </div>
  {:else if signIn.notYet && signIn.isFor(tab)}
    <div class="mt-4 rounded-xl border border-modified/35 bg-modified/10 px-3.5 py-2.5 text-[12.5px] text-fg-muted" transition:slide={{ duration: 160 }}>
      <span class="font-semibold text-fg">Not signed in yet.</span> The window was closed before {host ?? "the remote"} accepted you. Open it again to continue.
    </div>
  {/if}
{/snippet}

<!-- Paste a username + token; for HTTPS remotes. -->
{#snippet tokenForm()}
  <form class="mt-2 space-y-2.5" onsubmit={saveToken}>
    <label class="flex flex-col gap-1.5">
      <span class="text-[12px] font-medium text-fg-muted">Username</span>
      <div class="glass-well flex items-center rounded-lg transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_var(--color-accent-soft)]">
        <input
          bind:value={username}
          placeholder={github ? "Your GitHub username" : "Your username"}
          spellcheck="false"
          autocomplete="username"
          class="h-9 w-full bg-transparent px-3 text-[13px] text-fg outline-none placeholder:text-fg-faint"
        />
      </div>
    </label>
    <label class="flex flex-col gap-1.5">
      <span class="text-[12px] font-medium text-fg-muted">Token or password</span>
      <div class="glass-well flex items-center rounded-lg transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_var(--color-accent-soft)]">
        <input
          type="password"
          bind:value={secret}
          placeholder={github ? "ghp_… or github_pat_…" : "Personal access token"}
          spellcheck="false"
          autocomplete="off"
          class="h-9 w-full bg-transparent px-3 font-mono text-[12.5px] text-fg outline-none placeholder:font-sans placeholder:text-fg-faint"
        />
      </div>
    </label>
    {#if signIn.credentialError}
      <p class="text-[12px] leading-snug text-deleted" transition:slide={{ duration: 140 }}>{signIn.credentialError}</p>
    {/if}
    <div class="flex items-center justify-between gap-2 pt-0.5">
      <span class="text-[11.5px] text-fg-faint">Saved in your computer's Git credential manager, not in Orbe.</span>
      <button type="submit" class="btn-primary h-8 shrink-0 px-3 text-[12.5px]" disabled={signIn.saving || busy || !username.trim() || !secret.trim()}>
        {#if signIn.saving}<LoaderCircle size={13} class="animate-spin" />{:else}<KeyRound size={13} />{/if}
        Sign in
      </button>
    </div>
  </form>
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
            <p>Sign in with your company account and approve access for Git. It opens right here in Orbe.</p>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <button
                class="btn-primary h-8 px-3 text-[12.5px]"
                disabled={busy}
                onclick={() => openHere(error.url ?? signInPage ?? `https://${host ?? "github.com"}`, `Authorize access · ${host ?? "remote"}`)}
              >
                <LogIn size={14} />
                {error.url ? "Authorize in Orbe" : `Sign in to ${host ?? "the remote"}`}
              </button>
              <button class="text-[12px] text-fg-faint hover:text-fg-muted hover:underline" onclick={() => openOutside(error.url ?? `https://${host ?? "github.com"}`)}>
                or use your browser <ExternalLink size={11} class="inline" />
              </button>
            </div>
          {/snippet}
          {@render step(1, s1)}
          {#if github}
            {#snippet s2()}
              <p>
                If GitHub doesn't offer to authorize, enable SSO on the {ssh ? "SSH key" : "token"} Git uses: open your
                <button class="text-accent hover:underline" onclick={() => openHere(ssh ? "https://github.com/settings/keys" : "https://github.com/settings/tokens", ssh ? "SSH keys · GitHub" : "Tokens · GitHub")}>
                  {ssh ? "SSH keys" : "tokens"}
                </button>
                and choose <em>Configure SSO</em> next to it.
              </p>
            {/snippet}
            {@render step(2, s2)}
          {/if}
          {#snippet s3()}
            <p>That's it: Orbe notices when access is granted and retries the {issue.op} for you.</p>
          {/snippet}
          {@render step(github ? 3 : 2, s3)}
        </ol>
        {@render watching()}
      {:else if error.kind === "auth"}
        {#if ssh}
          <p>This remote uses SSH, so Git signs in with a key from this computer. Make sure the key is loaded and added to your {host ?? "remote"} account.</p>
          <ol class="mt-4 space-y-4">
            {#snippet k1()}
              <p>Check that your key is loaded and accepted:</p>
              {@render code(`ssh-add -l && ssh -T git@${host ?? "github.com"}`, "ssh")}
            {/snippet}
            {@render step(1, k1)}
            {#if github || gitlab}
              {#snippet k2()}
                <p>Not there? Add your public key to your account:</p>
                <button
                  class="btn-ghost mt-2"
                  onclick={() => openHere(github ? "https://github.com/settings/keys" : `https://${host}/-/user_settings/ssh_keys`, `SSH keys · ${host}`)}
                >
                  <KeyRound size={14} /> Open SSH keys in Orbe
                </button>
              {/snippet}
              {@render step(2, k2)}
            {/if}
          </ol>
          {@render watching()}
        {:else}
          <p>Sign in to {host ?? "the remote"} with a personal access token. Orbe hands it to your computer's Git sign-in, checks it, and retries.</p>
          <ol class="mt-4 space-y-4">
            {#if tokenPage}
              {#snippet t1()}
                <p>Create a token that can read and write repositories.</p>
                <button class="btn-ghost mt-2" onclick={() => openHere(tokenPage!, `New token · ${host}`)}>
                  <AppWindow size={14} /> Create a token in Orbe
                </button>
                {#if github}
                  <p class="mt-1.5 text-[12px] text-fg-faint">If your organization uses SSO, choose <em>Configure SSO</em> on the new token too.</p>
                {/if}
              {/snippet}
              {@render step(1, t1)}
            {/if}
            {#snippet t2()}
              <p>{tokenPage ? "Paste it here:" : "Enter your username and a token (or password):"}</p>
              {@render tokenForm()}
            {/snippet}
            {@render step(tokenPage ? 2 : 1, t2)}
          </ol>
          {@render watching()}
        {/if}

        <button
          class="mt-5 flex items-center gap-1 text-[12px] text-fg-faint hover:text-fg-muted"
          onclick={() => (showTerminal = !showTerminal)}
        >
          <ChevronRight size={13} class={["transition-transform", showTerminal && "rotate-90"]} />
          Prefer the terminal?
        </button>
        {#if showTerminal}
          <div transition:slide={{ duration: 160 }}>
            <p class="mt-1.5 text-[12.5px]">Run this once; Git will ask for your credentials or open your browser. Then retry here.</p>
            {@render code(command, "cmd")}
          </div>
        {/if}
      {:else if error.kind === "rejected" && host}
        <button class="btn-ghost" onclick={() => openHere(error.url ?? `https://${host}`, host)}><AppWindow size={14} /> Open {host} in Orbe</button>
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
      <button class="btn h-9 px-3" onclick={() => (signIn.cancel(), tab.dismissRemoteIssue())}>Dismiss</button>
      <button class="btn-primary h-9" disabled={busy} onclick={retry}>
        {#if busy}<LoaderCircle size={14} class="animate-spin" />{:else}<RotateCw size={14} />{/if}
        {error.kind === "behind" ? "Pull, then push" : `Retry ${issue.op}`}
      </button>
    </footer>
  </div>
</div>

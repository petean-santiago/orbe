<script lang="ts">
  /**
   * Keeps a failed fetch/pull/push visible until it's fixed, so a push that
   * never reached the remote can't pass for one that did. Also explains a
   * long-running remote operation, which is often a sign-in waiting in the
   * browser.
   */
  import { AppWindow, Globe, KeyRound, LoaderCircle, RotateCw, ShieldAlert, TriangleAlert, X } from "@lucide/svelte";
  import { slide } from "svelte/transition";
  import { app } from "../state.svelte";
  import { remoteIssueText } from "../remoteIssue";
  import { signIn } from "../signIn.svelte";

  const tab = $derived(app.active);
  const issue = $derived(tab.remoteIssue);
  const text = $derived(issue ? remoteIssueText(issue, tab.headBranch?.name ?? null) : null);
  const needsSignIn = $derived(issue?.error.kind === "sso" || issue?.error.kind === "auth");

  const ING = { fetch: "Fetching", pull: "Pulling", push: "Pushing" } as const;
</script>

{#if issue && signIn.status === "waiting" && signIn.isFor(tab) && !tab.remoteIssueOpen}
  <div class="px-2 pb-2" transition:slide={{ duration: 180 }}>
    <div class="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-3.5 py-2 text-[12.5px]">
      <LoaderCircle size={15} class="shrink-0 animate-spin text-accent" />
      <span class="min-w-0 flex-1 truncate text-fg-muted">
        <span class="font-semibold text-fg">Waiting for you to sign in</span>
        · Orbe will {issue.op} again as soon as {issue.error.host ?? "the remote"} lets you in.
      </span>
      <button class="btn h-7 shrink-0 px-2.5 text-[12px]" onclick={() => signIn.focus()}><AppWindow size={13} /> Show window</button>
      <button class="icon-btn size-7 shrink-0" title="Stop waiting" onclick={() => signIn.cancel()}><X size={14} /></button>
    </div>
  </div>
{:else if tab.remoteOp && tab.remoteSlow}
  <div class="px-2 pb-2" transition:slide={{ duration: 180 }}>
    <div class="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-[12.5px]">
      <LoaderCircle size={15} class="shrink-0 animate-spin text-accent" />
      <span class="min-w-0 flex-1 text-fg-muted">
        <span class="font-semibold text-fg">{ING[tab.remoteOp]} is taking a while</span>
        · if a sign-in window opened, finish it there and Orbe will carry on by itself.
      </span>
    </div>
  </div>
{:else if issue && text}
  <div class="px-2 pb-2" transition:slide={{ duration: 180 }}>
    <div
      class={[
        "flex items-center gap-3 rounded-xl border px-3.5 py-2 text-[12.5px]",
        needsSignIn ? "border-conflict/40 bg-conflict/10" : "border-modified/35 bg-modified/10",
      ]}
    >
      {#if issue.error.kind === "sso"}
        <ShieldAlert size={16} class="shrink-0 text-conflict" />
      {:else if issue.error.kind === "auth"}
        <KeyRound size={16} class="shrink-0 text-conflict" />
      {:else if issue.error.kind === "network"}
        <Globe size={16} class="shrink-0 text-modified" />
      {:else}
        <TriangleAlert size={16} class="shrink-0 text-modified" />
      {/if}
      <span class="min-w-0 flex-1 truncate text-fg-muted">
        <span class="font-semibold text-fg">{text.banner}</span> · {text.title}
      </span>
      <button class="btn h-7 shrink-0 px-2.5 text-[12px]" onclick={() => (tab.remoteIssueOpen = true)}>How to fix</button>
      <button
        class="btn-primary h-7 shrink-0 px-3 text-[12px]"
        disabled={!!tab.remoteOp}
        onclick={() => (issue.error.kind === "behind" ? tab.pullThenPush() : tab.remote(issue.op))}
      >
        {#if tab.remoteOp}<LoaderCircle size={13} class="animate-spin" />{:else}<RotateCw size={13} />{/if}
        {issue.error.kind === "behind" ? "Pull, then push" : `Retry ${issue.op}`}
      </button>
      <button class="icon-btn size-7 shrink-0" title="Dismiss" onclick={() => tab.dismissRemoteIssue()}><X size={14} /></button>
    </div>
  </div>
{/if}

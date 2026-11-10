/**
 * Plain-language wording for a fetch/pull/push that didn't go through,
 * shared by the banner and the help dialog.
 */
import type { RemoteIssue } from "./state.svelte";

const DONE = { fetch: "fetched", pull: "pulled", push: "pushed" } as const;
const NAME = { fetch: "Fetch", pull: "Pull", push: "Push" } as const;

export interface RemoteIssueText {
  /** "Push didn't go through" */
  banner: string;
  /** Short reason, e.g. "single sign-on needed for github.com". */
  title: string;
  /** Dialog heading. */
  heading: string;
  /** One or two sentences: what happened and that nothing was lost. */
  lead: string;
}

export function remoteIssueText(issue: RemoteIssue, branch: string | null): RemoteIssueText {
  const { op, error } = issue;
  const host = error.host ?? "the remote";
  const where = error.remote && error.host ? `${error.remote} (${error.host})` : (error.remote ?? host);
  const nothing = op === "push" ? "Nothing was pushed: your commits are safe on this computer." : `Nothing was ${DONE[op]}.`;
  const banner = `${NAME[op]} didn't go through`;

  switch (error.kind) {
    case "sso":
      return {
        banner,
        title: `single sign-on needed for ${host}`,
        heading: "Single sign-on required",
        lead: `${host} needs you to authorize your access through your organization's single sign-on (SSO) before Git can use it. ${nothing}`,
      };
    case "auth":
      return {
        banner,
        title: `couldn't sign in to ${host}`,
        heading: "Sign-in required",
        lead: `Git couldn't sign in to ${where}: it needs credentials, or the ones it has were refused. ${nothing}`,
      };
    case "behind":
      return {
        banner,
        title: "the remote has newer commits",
        heading: "The remote has newer commits",
        lead: `Someone pushed to ${branch ?? "this branch"} before you. Pull their changes, then push again. ${nothing}`,
      };
    case "rejected":
      return {
        banner,
        title: `${host} refused it`,
        heading: "The remote refused the push",
        lead: `${host} rejected it, usually because the branch is protected or a server check failed. Push to a new branch and open a pull request instead, or see the details below.`,
      };
    case "not-pushed":
      return {
        banner,
        title: "your commits aren't on the remote yet",
        heading: "The push didn't finish",
        lead: `Git ended without an error, but some commits still aren't on ${where}. This can happen when a sign-in step was interrupted. Try again; if it keeps happening, check the details below.`,
      };
    case "network":
      return {
        banner,
        title: `couldn't reach ${host}`,
        heading: `Couldn't reach ${host}`,
        lead: `Check your internet connection or VPN, then try again. ${nothing}`,
      };
    default:
      return {
        banner,
        title: "git reported an error",
        heading: `${NAME[op]} failed`,
        lead: `${nothing} Git's message is below.`,
      };
  }
}

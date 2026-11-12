/**
 * Signing in without leaving Orbe.
 *
 * A remote that needs SSO authorization or a sign-in opens its page in a
 * window inside Orbe. While it's open we quietly ask the remote whether it
 * accepts us yet (on every page load, and every few seconds); the moment it
 * does, the window closes and the fetch/pull/push that failed runs again.
 *
 * For HTTPS remotes you can also paste a username and token straight into the
 * help dialog: Orbe hands them to Git's credential helper, checks them, and
 * retries.
 */
import { asRemoteError, authWindow, git, type RemoteError } from "./api";
import { app, type RemoteOp, type RepoTab } from "./state.svelte";

const POLL_MS = 5000;
const MIN_GAP_MS = 2000;

class SignInFlow {
  /** "waiting": the sign-in window is open and we're watching for success. */
  status = $state<"idle" | "waiting">("idle");
  /** A background access check is in flight. */
  checking = $state(false);
  /** The window was closed before the remote accepted us. */
  notYet = $state(false);
  /** Saving a pasted token. */
  saving = $state(false);
  /** Why the pasted credentials didn't work. */
  credentialError = $state<string | null>(null);

  private tab: RepoTab | null = null;
  private op: RemoteOp | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private unlisten: (() => void) | null = null;
  private lastCheck = 0;

  /** Whether the sign-in flow belongs to this tab. */
  isFor(tab: RepoTab) {
    return this.tab === tab;
  }

  /** Open `url` in the in-app window and retry `op` as soon as the remote lets us in. */
  async start(tab: RepoTab, op: RemoteOp, url: string, title?: string) {
    this.stopWatching();
    this.tab = tab;
    this.op = op;
    this.notYet = false;
    this.status = "waiting";
    this.unlisten = await authWindow.listen((e) => {
      if (e.event === "loaded") void this.check();
      else void this.onClosed();
    });
    try {
      await authWindow.open(url, title);
    } catch (e) {
      this.stopWatching();
      app.toast("error", "Couldn't open the sign-in window", asRemoteError(e).message);
      return;
    }
    this.poll = setInterval(() => void this.check(), POLL_MS);
  }

  /** Open a page (token or key settings) in the same window, keeping the watch going. */
  async show(tab: RepoTab, op: RemoteOp, url: string, title?: string) {
    if (this.status === "waiting" && this.tab === tab) await authWindow.open(url, title);
    else await this.start(tab, op, url, title);
  }

  focus() {
    void authWindow.focus();
  }

  /** Stop watching and close the window. */
  async cancel() {
    this.stopWatching();
    await authWindow.close().catch(() => {});
  }

  /** Paste-a-token sign-in for HTTPS remotes. Returns whether it worked. */
  async saveCredential(tab: RepoTab, op: RemoteOp, username: string, secret: string): Promise<boolean> {
    if (!tab.repo || this.saving) return false;
    this.saving = true;
    this.credentialError = null;
    try {
      await git.storeCredential(tab.repo.path, username, secret);
      try {
        await git.checkRemoteAccess(tab.repo.path);
      } catch (e) {
        const err = asRemoteError(e);
        this.credentialError =
          err.kind === "sso"
            ? "The token was saved, but your organization still needs to authorize it for single sign-on."
            : err.kind === "auth"
              ? "The remote didn't accept those credentials. Check the username and that the token can read and write repositories."
              : err.message;
        return false;
      }
      await this.succeed(tab, op);
      return true;
    } catch (e) {
      this.credentialError = asRemoteError(e).message;
      return false;
    } finally {
      this.saving = false;
    }
  }

  private async check(final = false): Promise<boolean> {
    const tab = this.tab;
    if (this.status !== "waiting" || !tab?.repo) return false;
    if (this.checking || (!final && Date.now() - this.lastCheck < MIN_GAP_MS)) return false;
    this.lastCheck = Date.now();
    this.checking = true;
    let error: RemoteError | null = null;
    try {
      await git.checkRemoteAccess(tab.repo.path);
    } catch (e) {
      error = asRemoteError(e);
    } finally {
      this.checking = false;
    }
    // Only sign-in problems mean "not yet"; anything else (offline, say) we
    // leave for the real retry to report.
    if (error && (error.kind === "sso" || error.kind === "auth")) return false;
    if (this.status !== "waiting" || this.tab !== tab) return false;
    const op = this.op!;
    this.stopWatching();
    await authWindow.close().catch(() => {});
    // Already retried by hand and it went through: nothing left to do.
    if (!tab.remoteIssue) return true;
    await this.succeed(tab, op);
    return true;
  }

  private async onClosed() {
    if (this.status !== "waiting") return;
    // One last look: the sign-in may have finished on the page they just closed.
    const ok = await this.check(true);
    if (!ok && this.status === "waiting") {
      this.stopWatching();
      this.notYet = true;
    }
  }

  private async succeed(tab: RepoTab, op: RemoteOp) {
    this.notYet = false;
    tab.remoteIssueOpen = false;
    app.toast("success", "Signed in", `Running ${op} again…`);
    await tab.remote(op);
  }

  private stopWatching() {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    this.unlisten?.();
    this.unlisten = null;
    this.status = "idle";
    this.checking = false;
  }
}

export const signIn = new SignInFlow();

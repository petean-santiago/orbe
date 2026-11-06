<script lang="ts">
  /**
   * Rendered Markdown, GitHub-style: tables, task lists, code blocks with
   * syntax highlighting, and images from the repository. Output is sanitized
   * with DOMPurify, and links never navigate the app away.
   */
  import DOMPurify from "dompurify";
  import { Marked } from "marked";
  import { git } from "../api";
  import { app } from "../state.svelte";
  import { tokenize } from "../highlight";

  let { text, path }: { text: string; path: string } = $props();

  const marked = new Marked({ gfm: true, breaks: false });
  const html = $derived(DOMPurify.sanitize(marked.parse(text, { async: false }) as string));
  let root: HTMLElement | undefined = $state();

  const dir = $derived(path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");
  const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");

  /** Resolve a link/image path relative to this Markdown file. */
  function resolve(href: string): string {
    const clean = href.split("#")[0].split("?")[0];
    const parts = (clean.startsWith("/") ? clean.slice(1) : dir + clean).split("/");
    const out: string[] = [];
    for (const p of parts) {
      if (p === "..") out.pop();
      else if (p && p !== ".") out.push(decodeURIComponent(p));
    }
    return out.join("/");
  }

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // After each render: highlight code blocks and load repository images.
  $effect(() => {
    void html;
    const el = root;
    const repo = app.repo;
    if (!el || !repo) return;
    let cancelled = false;
    const urls: string[] = [];

    for (const code of el.querySelectorAll<HTMLElement>("pre > code")) {
      const lang = /language-([\w+#-]+)/.exec(code.className)?.[1];
      if (!lang) continue;
      const source = code.textContent ?? "";
      tokenize(source.replace(/\n$/, ""), `x.${lang}`).then((tokens) => {
        if (cancelled || !tokens) return;
        code.innerHTML = tokens
          .map((line) => line.map((t) => `<span style="color:${t.color}">${esc(t.content)}</span>`).join(""))
          .join("\n");
      });
    }

    for (const img of el.querySelectorAll<HTMLImageElement>("img")) {
      const src = img.getAttribute("src") ?? "";
      if (!src || isExternal(src)) continue;
      const file = resolve(src);
      const ext = file.split(".").pop()?.toLowerCase() ?? "";
      git
        .readFileBase64(repo.path, file)
        .then((b64) => {
          if (cancelled) return;
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const type = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
          const url = URL.createObjectURL(new Blob([bytes], { type }));
          urls.push(url);
          img.src = url;
        })
        .catch(() => img.classList.add("missing"));
    }

    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  });

  function onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    // Never let a link navigate the app's window.
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (!href || href.startsWith("#")) {
      const id = href.slice(1);
      if (id) root?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (isExternal(href)) {
      navigator.clipboard.writeText(href);
      app.toast("info", "Link copied", href);
      return;
    }
    app.active.openFile(resolve(href));
  }
</script>

<div class="h-full overflow-auto bg-black/20">
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <article bind:this={root} class="md-doc selectable mx-auto max-w-[860px] px-10 py-9" onclick={onClick}>
    {@html html}
  </article>
</div>

<style>
  .md-doc {
    font-size: 14px;
    line-height: 1.7;
    color: var(--color-fg-muted);
    overflow-wrap: anywhere;
  }
  .md-doc :global(> :first-child) {
    margin-top: 0;
  }
  .md-doc :global(h1),
  .md-doc :global(h2),
  .md-doc :global(h3),
  .md-doc :global(h4) {
    font-family: var(--font-display);
    font-weight: var(--display-weight, 700);
    letter-spacing: var(--display-tracking, -0.02em);
    color: var(--color-fg);
    line-height: 1.25;
    margin: 1.8em 0 0.6em;
  }
  .md-doc :global(h1) {
    font-size: 2em;
    padding-bottom: 0.35em;
    border-bottom: 1px solid var(--color-line-soft);
  }
  .md-doc :global(h2) {
    font-size: 1.5em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid var(--color-line-soft);
  }
  .md-doc :global(h3) {
    font-size: 1.2em;
  }
  .md-doc :global(p),
  .md-doc :global(ul),
  .md-doc :global(ol),
  .md-doc :global(blockquote),
  .md-doc :global(pre),
  .md-doc :global(table) {
    margin: 0 0 1em;
  }
  .md-doc :global(a) {
    color: var(--color-accent-fg);
    text-decoration: underline;
    text-decoration-color: color-mix(in oklch, var(--color-accent) 45%, transparent);
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .md-doc :global(strong) {
    color: var(--color-fg);
  }
  .md-doc :global(ul),
  .md-doc :global(ol) {
    padding-left: 1.6em;
  }
  .md-doc :global(ul) {
    list-style: disc;
  }
  .md-doc :global(ol) {
    list-style: decimal;
  }
  .md-doc :global(li) {
    margin: 0.25em 0;
  }
  .md-doc :global(li::marker) {
    color: var(--color-accent);
  }
  .md-doc :global(li:has(> input[type="checkbox"])) {
    list-style: none;
    margin-left: -1.4em;
  }
  .md-doc :global(input[type="checkbox"]) {
    accent-color: var(--color-accent);
    margin-right: 0.5em;
    vertical-align: middle;
  }
  .md-doc :global(code) {
    font-family: var(--font-mono);
    font-size: 0.86em;
    padding: 0.15em 0.4em;
    border-radius: 6px;
    background: var(--color-surface-3);
    color: var(--color-accent-fg);
  }
  .md-doc :global(pre) {
    padding: 14px 16px;
    border-radius: 12px;
    border: 1px solid var(--color-line-soft);
    background: oklch(0.07 0.01 300 / 0.8);
    overflow-x: auto;
  }
  .md-doc :global(pre code) {
    padding: 0;
    background: none;
    color: var(--code-fg);
    font-size: 12.5px;
    line-height: 1.6;
  }
  .md-doc :global(blockquote) {
    padding: 0.2em 1em;
    border-left: 3px solid var(--color-accent);
    color: var(--color-fg-faint);
    background: var(--color-surface-1);
    border-radius: 0 8px 8px 0;
  }
  .md-doc :global(hr) {
    border: none;
    border-top: 1px solid var(--color-line);
    margin: 2em 0;
  }
  .md-doc :global(img) {
    max-width: 100%;
    border-radius: 8px;
    display: inline-block;
  }
  .md-doc :global(img.missing) {
    display: none;
  }
  .md-doc :global(table) {
    border-collapse: collapse;
    display: block;
    overflow-x: auto;
    font-size: 13px;
  }
  .md-doc :global(th),
  .md-doc :global(td) {
    padding: 7px 13px;
    border: 1px solid var(--color-line);
  }
  .md-doc :global(th) {
    color: var(--color-fg);
    background: var(--color-surface-2);
    font-weight: 600;
  }
  .md-doc :global(tr:nth-child(even) td) {
    background: var(--color-surface-1);
  }
</style>

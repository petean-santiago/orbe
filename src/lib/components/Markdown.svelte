<script lang="ts">
  /**
   * Minimal, safe Markdown for assistant replies: everything is HTML-escaped
   * first, then only our own tags are added. Links are shown, not followed.
   */
  let { text }: { text: string } = $props();

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function inline(raw: string): string {
    // Protect inline code first so its contents aren't formatted.
    const codes: string[] = [];
    let s = esc(raw).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<span class="md-link" title="$2">$1</span>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  }

  const parsed = $derived.by(() => {
    const code: string[] = [];
    const html: string[] = [];
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    let para: string[] = [];
    let list: { ordered: boolean; items: string[] } | null = null;

    const flushPara = () => {
      if (para.length) html.push(`<p>${para.map(inline).join("<br>")}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list) {
        const tag = list.ordered ? "ol" : "ul";
        html.push(`<${tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${tag}>`);
      }
      list = null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = /^\s*`{3,}\s*([\w+-]*)/.exec(line);
      if (fence) {
        flushPara();
        flushList();
        const body: string[] = [];
        for (i++; i < lines.length && !/^\s*`{3,}\s*$/.test(lines[i]); i++) body.push(lines[i]);
        const idx = code.push(body.join("\n")) - 1;
        html.push(
          `<div class="md-code"><div class="md-code-head"><span>${esc(fence[1] || "code")}</span><button type="button" data-copy="${idx}">Copy</button></div><pre><code>${esc(body.join("\n"))}</code></pre></div>`,
        );
        continue;
      }
      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
      const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (heading) {
        flushPara();
        flushList();
        html.push(`<h4>${inline(heading[2])}</h4>`);
      } else if (bullet || numbered) {
        flushPara();
        const ordered = !!numbered;
        if (list && list.ordered !== ordered) flushList();
        list ??= { ordered, items: [] };
        list.items.push((bullet ?? numbered)![1]);
      } else if (!line.trim()) {
        flushPara();
        flushList();
      } else if (list && /^\s{2,}/.test(line)) {
        list.items[list.items.length - 1] += " " + line.trim();
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara();
    flushList();
    return { html: html.join(""), code };
  });

  function onClick(e: MouseEvent) {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-copy]");
    if (!btn) return;
    navigator.clipboard.writeText(parsed.code[Number(btn.dataset.copy)] ?? "");
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = "Copy"), 1200);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="md selectable" onclick={onClick}>{@html parsed.html}</div>

<style>
  .md {
    font-size: 13px;
    line-height: 1.6;
    color: var(--color-fg-muted);
    overflow-wrap: anywhere;
  }
  .md :global(p),
  .md :global(ul),
  .md :global(ol),
  .md :global(h4),
  .md :global(.md-code) {
    margin: 0 0 0.6em;
  }
  .md :global(> :last-child) {
    margin-bottom: 0;
  }
  .md :global(h4) {
    color: var(--color-fg);
    font-weight: 600;
    font-size: 13.5px;
    margin-top: 0.9em;
  }
  .md :global(strong) {
    color: var(--color-fg);
    font-weight: 600;
  }
  .md :global(ul),
  .md :global(ol) {
    padding-left: 1.2em;
  }
  .md :global(ul) {
    list-style: disc;
  }
  .md :global(ol) {
    list-style: decimal;
  }
  .md :global(li) {
    margin: 0.15em 0;
  }
  .md :global(li::marker) {
    color: var(--color-accent);
  }
  .md :global(code) {
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 1px 5px;
    border-radius: 5px;
    background: var(--color-surface-3);
    color: var(--color-accent-fg);
  }
  .md :global(.md-link) {
    color: var(--color-accent-fg);
    text-decoration: underline;
    text-decoration-color: color-mix(in oklch, var(--color-accent) 50%, transparent);
  }
  .md :global(.md-code) {
    border: 1px solid var(--color-line-soft);
    border-radius: 10px;
    overflow: hidden;
    background: oklch(0.06 0.01 320 / 0.7);
  }
  .md :global(.md-code-head) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 6px 4px 10px;
    font-size: 11px;
    color: var(--color-fg-faint);
    border-bottom: 1px solid var(--color-line-soft);
  }
  .md :global(.md-code-head button) {
    padding: 1px 8px;
    border-radius: 6px;
    color: var(--color-fg-muted);
  }
  .md :global(.md-code-head button:hover) {
    background: var(--color-surface-3);
    color: var(--color-fg);
  }
  .md :global(pre) {
    margin: 0;
    padding: 10px 12px;
    overflow-x: auto;
  }
  .md :global(pre code) {
    padding: 0;
    background: none;
    color: var(--color-fg);
    font-size: 12px;
    line-height: 1.55;
  }
</style>

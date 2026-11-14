# Orbe on LinkedIn

Images for announcing Orbe. Every PNG is exported at 2x for sharp text on high-density screens.

## posts/

| File | Size | Use |
| --- | --- | --- |
| `launch-landscape.png` | 1200×627 (2x) | Single-image post, or the image shown with a link |
| `launch-square.png` | 1080×1080 (2x) | Single-image post that takes more room in the feed |
| `orbe-linkedin-carousel.pdf` | 5 pages, 1080×1350 | Carousel post: upload it as a **document** |
| `carousel-*.png` | 1080×1350 (2x) | The carousel pages as separate images |

## screenshots/

The plain app, captured from the demo repository at 1440×900 (2x): commit graph, changes, merge conflicts and the
single sign-on help. Use them in the comments, in the Featured section or wherever a raw screenshot fits better.

## source/

`posts.html` contains all the designs. Edit it, then re-export the PNGs:

```bash
npm i playwright-core   # once, anywhere
node source/render.cjs "$PWD/source/posts.html" "$PWD/posts"
```

`render.cjs` uses Playwright's Chromium, so set its `executablePath` to a Chrome or Chromium on your machine.

## Post copy (draft)

> I'm sharing **Orbe**: a desktop Git client I made because I wanted
> Git to feel calm again.
>
> What it does:
> 🪐 A colour-coded commit graph that shows what's waiting to be pushed or pulled
> 🧩 Merge conflicts resolved inside the app: by hand or with AI, with a one-line reason for every decision
> 🔐 Pushes that never fail silently: company SSO and sign-in problems explained in plain words, with sign-in
> right there and an automatic retry
> ✨ Bring your own AI: Claude, ChatGPT or a local model writes your commit messages and answers questions about
> your repo
>
> It runs on macOS, Windows and Linux, built with Tauri, Rust and Svelte.
>
> Download it at orbe.santiago-petean.com. I'd love to hear what you think, and what would make it your
> everyday Git client.
>
> #git #developertools #rust #svelte #tauri

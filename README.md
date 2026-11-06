<p align="center">
  <img src="app-icon.svg" width="112" alt="Orbe logo" />
</p>

<h1 align="center">Orbe</h1>
<p align="center">A calm, beautiful Git client for Windows, macOS (Apple Silicon) and Linux.</p>

---

Orbe is a desktop Git client in the spirit of Fork, built with **Tauri 2 + Rust + Svelte 5**.
Design matters as much as features: the look is dark fuchsia glassmorphism on a near-black base,
with distinctive typography, and every user can rearrange the interface to suit them.

**Status:** v0.1, early development. The core day-to-day workflow (open, browse history, stage,
commit, branch, fetch/pull/push) works. See [Roadmap](#roadmap) for what's next.

## Contents

- [Quick start](#quick-start)
- [Features](#features)
- [Architecture](#architecture)
- [Project layout](#project-layout)
- [Common tasks](#common-tasks)
- [Design system](#design-system)
- [Conventions and gotchas](#conventions-and-gotchas)
- [Checks and builds](#checks-and-builds)
- [Roadmap](#roadmap)

## Quick start

### Prerequisites

- Node 20+ and **pnpm** 9+
- **Git** on `PATH` (Orbe calls the `git` CLI)
- **Rust** stable (via `rustup`) and the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/)
  - **Windows:** Visual Studio 2022 *Build Tools* with "Desktop development with C++" (Rust needs the MSVC linker). WebView2 ships with Windows 11.
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`).
  - **Linux:** `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`, `libdbus-1-dev` (keychain), or the equivalents for your distro.

### Run it

```bash
pnpm install
pnpm tauri dev      # desktop app with hot reload (Rust changes trigger a rebuild)
```

The first `tauri dev` compiles every Rust dependency and takes a few minutes. Later runs are fast.

### Browser preview (no Rust needed)

Most UI work can be done in the browser:

```bash
pnpm dev            # http://localhost:1420
```

Without the Tauri backend, Orbe switches to an in-memory **demo repository** (`src/lib/mock.ts`).
URL parameters jump straight to a given state:

| URL                           | Opens                                             |
| ----------------------------- | ------------------------------------------------- |
| `/?demo`                      | The demo repository                               |
| `/?demo=2`                    | Two demo repositories in tabs                     |
| `/?demo&view=changes`         | The Changes view (also `view=files`)              |
| `/?demo&palette`              | The command palette                               |
| `/?demo&switcher`             | The branch switcher                               |
| `/?demo&assistant`            | The AI assistant panel (with demo replies)        |
| `/?demo&settings=arrange`     | Settings on a page (`appearance`, `typography`, `layout`, `arrange`, `ai`) |

> `pnpm dev` and `pnpm tauri dev` both use port **1420**. Stop one before starting the other.

## Features

- **Tabs:** open several repositories at once. Drag to reorder, middle-click to close. Open tabs are restored on restart, and each tab keeps its own view, selection and unfinished commit message.
- **History:** virtualized commit list with a coloured lane graph, branch and tag pills, commit details and per-file diffs. Details can sit below or beside the list.
- **Changes** (laid out like VS Code source control): the message box and **Commit** button sit at the top, with *Staged Changes* and *Changes* underneath. The first line of the message is the summary. With nothing staged, **Commit all** commits every change; use **+** on files to commit only those. The wand button writes the message with AI from exactly what will be committed, and the ▾ menu offers *Commit & Push* and *Amend last commit*. `Ctrl/⌘ Enter` commits.
- **Specialised diffs:** image diff with *Side by side*, *Swipe*, *Onion skin* and *Difference* (unchanged pixels go black); text diffs in *Unified* or *Split* layout with word-level highlights inside changed lines; and *Ignore whitespace* to hide indentation-only changes. Layout and whitespace choices are remembered.
- **Syntax highlighting** for 340+ languages (Shiki, the TextMate grammars VS Code uses) in the file viewer and every diff. Colours follow Orbe's palette and the accent; grammars load on demand.
- **File previews:** images (PNG, JPG, GIF, WebP, AVIF, BMP, ICO, TIFF, SVG) with fit/actual size, PDFs in the built-in viewer, and Markdown rendered GitHub-style (tables, task lists, highlighted code, repo images). A *Preview / Code / Changes* switch shows the raw source.
- **Files:** the whole project as a tree (respecting `.gitignore`) with VS Code–style icons (coloured folders that open and close, emblems for `src`, `docs`, `tests`, `.github`…, language-coloured files), change markers, clickable breadcrumbs, quick find, a file viewer with line numbers, and a File / Changes toggle for modified files. Right-click to create, rename or delete (deleted items go to the system trash).
- **Sidebar:** local branches grouped into folders (`feature/`, `fix/`…), remotes grouped by remote, tags, and a filter box. Click a branch to show it in History; hover and press **Switch** (or double-click) to check it out; right-click for more.
- **Travel back in history:** double-click any commit to *check it out* (detached HEAD), *create a branch there*, or *switch to a branch* whose tip it is. While you're on an older commit a banner says so, with **Back to <branch>** and **New branch here**.
- **Drag to merge:** drag a branch (sidebar row or history pill) onto another branch, or onto the current branch in the toolbar, then choose *Merge* or *Rebase*. If git stops for conflicts, a banner shows the merge/rebase in progress with **Continue** and **Abort**.
- **Branch switcher** (`Ctrl/⌘ B`, or click the branch in the toolbar): fuzzy search, most recently updated first, keyboard driven. Switching is instant in the UI while Git catches up, and typing a new name creates the branch.
- **Create anything:** the **New** toolbar menu, right-click menus and the palette create branches (from HEAD, a branch, a tag or any commit), tags, files and folders; rename, delete and merge branches; stash and apply stashes; clone a repository or create a new one.
- **AI assistant** (`Ctrl/⌘ J`): a chat panel that knows the repository state. Conversations are saved per repository (in the app data folder) and survive hiding the panel, switching tabs and restarting; start a **New chat**, reopen earlier ones from the list, or close a conversation to delete it. There is also **Generate** for commit messages, **Explain** for commits, and one-click "summarize my changes" / "review staged changes". See [AI providers](#ai-providers).
- **Sync at a glance in History:** each commit shows ✓✓ when it's already on the remote, ✓ and **bold** when you haven't pushed it, and a cloud with *italics* when it's on the remote but not pulled yet; the Description header shows a small legend with the counts.
- **What's waiting:** branches show **↓ to pull** and **↑ to push** counters, and Orbe fetches quietly in the background (every 15 min by default, Settings → Layout) so they stay current. You get a notice when new commits arrive for your branch.
- **Remote:** fetch (all remotes, prune), pull, and push. Push sets the upstream automatically on the first push.
- **Command palette** (`Ctrl/⌘ K`): actions, branches and commit search.
- **Settings** (`Ctrl/⌘ ,`): changes preview live and are saved locally.
  - *Appearance:* accent colour, glass level (frosted, clear or solid), background glow, density, interface size.
  - *Typography:* title font (Red Hat Display by default, plus nine other sans-serif options), interface and code fonts.
  - *Layout:* sidebar side, commit details position, avatars, relative dates.
  - *Arrange:* drag and drop to reorder and show/hide sidebar sections, toolbar items and history columns.
- **Adaptive layout:** works from a half-screen 680×480 window up to large monitors. On narrow windows the sidebar becomes an icon strip, toolbar labels turn into icons, history drops its least important columns, details stack vertically and the assistant floats over the content.
- **Resizable panels:** drag the edge between any two panels (sidebar, file lists, file tree, commit details, assistant, and the history and staged/unstaged splits). Sizes are saved; double-click an edge to reset it, or use Settings → Layout → Reset sizes.
- **Custom title bar:** native traffic lights on macOS, custom window controls on Windows and Linux.

### Keyboard shortcuts

| Shortcut            | Action                          |
| ------------------- | ------------------------------- |
| `Ctrl/⌘ K`          | Command palette                 |
| `Ctrl/⌘ T` / `W`    | New tab / close tab             |
| `Ctrl Tab`          | Next tab (`Shift` for previous) |
| `Ctrl/⌘ ,`          | Settings                        |
| `Ctrl/⌘ O`          | Open repository                 |
| `Ctrl/⌘ R`          | Refresh                         |
| `Ctrl/⌘ 1` / `2` / `3` | Changes / History / Files    |
| `Ctrl/⌘ B`          | Switch branch                   |
| `Ctrl/⌘ ⇧ B`        | New branch                      |
| `Ctrl/⌘ J`          | AI assistant                    |
| `Ctrl/⌘ \`          | Sidebar: full / icons only      |
| `↑` `↓`             | Move through commits            |
| `Ctrl/⌘ Enter`      | Commit                          |

## AI providers

Choose one in **Settings → AI assistant**. Orbe only contacts the provider when you ask it to, and sends
the relevant diff, file names and recent commit subjects.

| Provider              | Uses                                   | Setup                                                         |
| --------------------- | -------------------------------------- | ------------------------------------------------------------- |
| Claude API            | Anthropic API key, billed per use      | Paste a key from console.anthropic.com. Default model `claude-opus-5-5`. |
| Claude Code           | Your Claude Pro / Max plan             | `npm install -g @anthropic-ai/claude-code`, then run `claude` once to sign in. |
| OpenAI API            | OpenAI API key, billed per use         | Paste a key, then **Load models** and pick one.               |
| Codex CLI             | Your ChatGPT plan                      | `npm install -g @openai/codex`, then `codex login`.           |
| Local / compatible    | Any OpenAI-compatible server           | Ollama, LM Studio, OpenRouter… set the server address.        |

API keys are stored in the operating system keychain (Windows Credential Manager, macOS Keychain,
Linux Secret Service) by the Rust side (`src-tauri/src/ai.rs`); they never reach the webview or
`localStorage`. CLI providers run with the repository as working directory, in read-only mode.

Exposing Orbe itself as an MCP server, so tools like Claude Code can drive it, is on the roadmap.

## Architecture

```
┌──────────────────────── Svelte 5 UI (src/) ────────────────────────┐
│  components  ──►  app (state.svelte.ts)  ──►  git (api.ts)         │
│                     └─ RepoTab per tab           │                 │
│  settings.svelte.ts ─► CSS variables on <html>   │ invoke()        │
└──────────────────────────────────────────────────┼─────────────────┘
                                                   ▼  (or mock.ts in a browser)
┌──────────────────────── Rust core (src-tauri/) ────────────────────┐
│  #[tauri::command] fns in git.rs  ──►  `git` CLI subprocess        │
│                           ai.rs   ──►  HTTPS APIs / claude, codex  │
└────────────────────────────────────────────────────────────────────┘
```

**Backend (`src-tauri/src/git.rs`)**: each command shells out to `git` inside `spawn_blocking`
and parses machine-readable output, e.g. `status --porcelain -z` and `log` with `%x1f`/`%x1e` separators.
Subprocesses run with `GIT_TERMINAL_PROMPT=0`, so they never hang waiting for credentials, and with
`CREATE_NO_WINDOW` on Windows, so no console windows flash up. Errors are returned as strings and
shown as toasts. A move to [gitoxide (`gix`)](https://github.com/GitoxideLabs/gitoxide) for read-heavy
operations is planned; the CLI stays as the reliable fallback.

**Bridge (`src/lib/api.ts`)**: the typed `git` object wraps every command. When `__TAURI_INTERNALS__`
is missing (plain browser), it routes calls to `mock.ts` instead. Shared types (`Commit`, `Branch`,
`FileChange`, …) live here and must match the Rust `serde` structs.

**State (`src/lib/state.svelte.ts`)**: built on Svelte 5 runes.
- `RepoTab` holds everything for one repository: commits, graph, branches, status, selection, drafts and loading flags.
- `AppState` (exported as `app`) holds the tab list, recents, the palette and settings flags, and toasts.
- For convenience, getters on `app` proxy to the active tab, so `app.status` is the active tab's status.
- Tabs and recent repositories persist in `localStorage` (`orbe.tabs`, `orbe.recentRepos`).

**Settings (`src/lib/settings.svelte.ts`)**: one reactive `settings.value` object, persisted to
`localStorage` (`orbe.settings`). `apply()` writes CSS variables (`--accent-h`, `--font-sans`,
`--font-mono`) and `data-glass` / `data-density` attributes on `<html>`, and sets the webview zoom.
An `$effect` in `App.svelte` calls it whenever anything changes. Components read `settings.value`
directly for layout choices.

## Project layout

```
src/
  app.css                   design tokens + component classes (Tailwind v4 @theme)
  App.svelte                app shell, global shortcuts, URL preview helpers
  lib/
    api.ts                  typed bridge to Rust (+ browser mock fallback)
    mock.ts                 stateful demo repository for the browser preview
    state.svelte.ts         AppState + RepoTab
    settings.svelte.ts      preferences, defaults, option lists, AI providers
    ui.svelte.ts            context menus, form dialogs, floating panels
    actions.ts              user flows: create/rename/delete dialogs and menus
    assistant.svelte.ts     AI prompts and chat
    graph.ts                commit graph lane layout
    format.ts               dates, initials, avatar colours, platform helpers
    components/
      TitleBar, Toolbar, Sidebar          app chrome
      HistoryView, CommitList, CommitDetails
      ChangesView, FileList, DiffView
      FilesView, FileViewer               whole-project tree
      BranchSwitcher, ContextMenu, FormDialog
      AssistantPanel, Markdown, AiSettings
      CommandPalette, SettingsPanel, Welcome, Toasts
      Sortable, SortableList              pointer-based drag and drop
      Switch, Segmented, Splitter, ...    small primitives
src-tauri/
  src/lib.rs                command registration, window setup
  src/git.rs                Git and file commands exposed to the UI
  src/ai.rs                 AI providers and keychain storage
  tauri.conf.json           window, bundle and app identifier (app.orbe.desktop)
  capabilities/default.json permissions the frontend is allowed to use
  icons/                    generated app icons
app-icon.svg                logo source
.github/workflows/build.yml CI builds for macOS arm64, Linux and Windows
```

## Common tasks

### Add a Git operation

1. **Rust:** add a `#[tauri::command] async fn` in `src-tauri/src/git.rs`, using the existing `run_git` / `run_git_allow` helpers inside `blocking(...)`.
2. **Register it** in the `generate_handler![...]` list in `src-tauri/src/lib.rs`.
3. **Bridge:** add a typed wrapper to the `git` object in `src/lib/api.ts`.
4. **Mock:** implement the same function in `src/lib/mock.ts` so the browser preview keeps working.
5. **State:** add a method on `RepoTab` that calls it, then `refresh()` and `toast()` the result.
6. **UI:** wire it to a button and, ideally, a command palette entry.

### Add a setting

1. Add the field and its default to `Settings` in `settings.svelte.ts`. `load()` merges stored values with the defaults, so existing users pick up the new field automatically.
2. If the setting affects styling, apply it in `apply()` as a CSS variable or `data-*` attribute.
3. Add a control to the right page in `SettingsPanel.svelte`.

To make something rearrangeable, add an id to one of the ordered lists (`sidebarSections`, `toolbar`,
`columns`) along with its label, then render it in the component that loops over that list.

### Add a Tauri permission

If a frontend call fails with "not allowed", add the permission to `src-tauri/capabilities/default.json`.

### Regenerate icons

```bash
pnpm tauri icon app-icon.svg -o src-tauri/icons
```

Afterwards, delete the generated `android/` and `ios/` folders; desktop doesn't need them.

## Design system

All tokens live in `src/app.css` under `@theme` and use OKLCH.

- **Base:** `--color-base`, a near-black with a hint of magenta. The `surface-0`…`surface-4` tokens are translucent white overlays layered on top of it, and `line` / `line-soft` are for borders.
- **Accent:** every accent colour is derived from the `--accent-h` hue variable, so changing that one number re-themes the app. Use `accent`, `accent-strong`, `accent-soft` and `accent-glow`; don't hard-code pinks.
- **Glass:** use `.glass` for panels, `.glass-strong` for popovers and modals, and `.glass-well` for inset fields. They adapt to the user's glass setting automatically.
- **Type:**
  - `font-sans`: the interface font, Bricolage Grotesque by default.
  - `font-display` (Unbounded): only for large titles. It is very wide and hurts readability at small sizes.
  - `font-mono`: Commit Mono by default.
  - Base size is 13px. Avoid going below 11px.
- **Building blocks:** `.btn`, `.btn-primary`, `.btn-ghost`, `.icon-btn`, `.kbd`, `.section-label`.
- **Icons:** Lucide via `@lucide/svelte`, usually at 13–16px.

## Conventions and gotchas

- **Svelte 5 runes only.** Use `$state`, `$derived`, `$effect`, `$props` and snippets. Don't use legacy stores or `export let`.
- **Conditional classes with arbitrary values** must use the array form, `class={["base", cond && "pl-[78px]"]}`. `class:pl-[78px]` doesn't parse.
- **Drag and drop** uses pointer events (`Sortable.svelte`), not the HTML5 drag API, because Tauri intercepts native drag events on Windows. Put `data-no-drag` on buttons and switches inside sortable items.
- **JSON files must be UTF-8 without a BOM.** A BOM in `tauri.conf.json` breaks the build with "expected value at line 1 column 1". On Windows, avoid writing JSON with PowerShell `Set-Content` / `Out-File`.
- **TypeScript is pinned to 5.x.** `svelte-check` doesn't support TypeScript 7 yet.
- **Windows shells:** if `cargo` isn't found in a new terminal, add `%USERPROFILE%\.cargo\bin` to `PATH`.
- **Keep the mock in sync.** A feature that works in Tauri but breaks `pnpm dev` slows everyone down.

## Checks and builds

Run these before committing:

```bash
pnpm check                         # svelte-check + TypeScript, should report 0 errors / 0 warnings
pnpm build                         # frontend production build
cd src-tauri && cargo build        # Rust compiles without warnings
```

To build installers for the current platform:

```bash
pnpm tauri build                   # output in src-tauri/target/release/bundle/
```

CI (`.github/workflows/build.yml`) builds on macOS 14 (Apple Silicon), Ubuntu 22.04 and Windows,
and uploads the bundles as artifacts. Release signing and notarization aren't set up yet.

## Roadmap

Rough priorities. Nothing here is committed to yet.

- [ ] Line- and hunk-level staging in the diff view
- [ ] Stash list in the sidebar (create and apply are done)
- [ ] Rebase and cherry-pick from the sidebar and history
- [ ] Orbe as an MCP server, so AI tools can drive it
- [ ] Streaming AI replies
- [ ] Conflict resolution view
- [ ] File-system watcher instead of refresh-on-focus
- [ ] Credential handling for HTTPS/SSH push and pull (prompts are currently disabled)
- [ ] Blame and file history
- [ ] Side-by-side diff mode and syntax highlighting
- [ ] `gix` for faster log and status on large repositories
- [ ] Settings import/export; light theme
- [ ] Code signing, notarization and auto-update

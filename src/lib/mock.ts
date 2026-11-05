/**
 * Demo repository used when Orbe runs in a plain browser (no Tauri backend).
 * It is stateful, so staging and committing behave believably while designing.
 */
import type { Branch, Commit, FileChange, TreeEntry } from "./api";

const AUTHORS = [
  ["Ada Moreno", "ada@aurora.dev"],
  ["Kenji Watanabe", "kenji@aurora.dev"],
  ["Lena Fischer", "lena@aurora.dev"],
  ["Sam Okafor", "sam@aurora.dev"],
] as const;

const SUBJECTS = [
  "Refine sidebar spacing and hover states",
  "Add keyboard navigation to the file list",
  "Fix race condition when switching branches",
  "Improve diff rendering for long lines",
  "Extract theme tokens into a single source",
  "Cache repository status between refreshes",
  "Handle detached HEAD gracefully",
  "Polish empty states with illustrations",
  "Update dependencies",
  "Speed up commit graph layout by 3x",
  "Add tooltips to toolbar actions",
  "Document the release process",
  "Support renamed files in the changes view",
  "Make toasts dismissible",
  "Tidy up error messages",
];

let seq = 0;
function hash(): string {
  seq++;
  let h = (seq * 2654435761) >>> 0;
  let out = "";
  for (let i = 0; i < 5; i++) {
    h = (h ^ (h << 13)) >>> 0;
    h = (h ^ (h >>> 17)) >>> 0;
    h = (h ^ (h << 5)) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, 40);
}

function buildHistory(): Commit[] {
  const list: Commit[] = [];
  let time = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 45;
  let subjectIdx = 0;

  const add = (subject: string, parents: string[], authorIdx?: number): string => {
    const h = hash();
    const [author, email] = AUTHORS[authorIdx ?? seq % AUTHORS.length];
    time += 60 * (25 + ((seq * 37) % 400));
    list.push({ hash: h, shortHash: h.slice(0, 7), parents, author, email, timestamp: time, subject, refs: [] });
    return h;
  };
  const next = () => SUBJECTS[subjectIdx++ % SUBJECTS.length];

  let main = add("Initial commit", [], 0);
  main = add("Set up Tauri and Svelte project", [main], 0);
  main = add("Add CI workflow for all platforms", [main], 1);

  // Older history: a steady main line with short-lived feature branches.
  for (let k = 0; k < 30; k++) {
    main = add(next(), [main]);
    if (k % 6 === 2) {
      let f = add(next(), [main], 2);
      main = add(next(), [main]);
      f = add(next(), [f], 2);
      main = add(`Merge branch 'feature/${["search", "stash", "tags", "blame", "lfs"][k % 5]}'`, [main, f], 1);
    }
  }

  // Recent, more interesting topology.
  let auth = add("Add login form", [main], 3);
  auth = add("Wire up session store", [auth], 3);
  main = add("Fix typo in README", [main], 1);
  auth = add("Add OAuth providers", [auth], 3);
  main = add("Merge branch 'feature/auth'", [main, auth], 0);
  let perf = add("Virtualise the commit list", [main], 1);
  main = add("Bump dependencies", [main], 2);
  let theme = add("Introduce dark fuchsia palette", [main], 0);
  perf = add("Render graph lanes on demand", [perf], 1);
  theme = add("Add vibrancy to the sidebar", [theme], 0);
  main = add("Merge branch 'fix/graph-perf'", [main, perf], 1);
  const release = add("Release v0.2.0", [main], 2);
  main = release;
  theme = add("Animate panel transitions", [theme], 0);
  main = add("Show ahead/behind counters", [main], 3);

  const byHash = new Map(list.map((c) => [c.hash, c]));
  byHash.get(main)!.refs = ["HEAD -> main", "origin/main"];
  byHash.get(release)!.refs = ["tag: v0.2.0"];
  byHash.get(theme)!.refs = ["origin/feature/theme", "feature/theme"];

  return list.reverse();
}

let commits = buildHistory();

let status: FileChange[] = [
  { path: "src/lib/components/CommitGraph.svelte", oldPath: null, status: "modified", staged: true },
  { path: "src/lib/graph.ts", oldPath: null, status: "modified", staged: true },
  { path: "src/app.css", oldPath: null, status: "modified", staged: false },
  { path: "src/lib/components/Toasts.svelte", oldPath: null, status: "untracked", staged: false },
  { path: "docs/old-architecture.md", oldPath: null, status: "deleted", staged: false },
  { path: "README.md", oldPath: null, status: "modified", staged: false },
];

const now = Math.floor(Date.now() / 1000);
const H = 3600;
const br = (name: string, kind: Branch["kind"], extra: Partial<Branch> = {}): Branch => ({
  name,
  kind,
  isHead: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  updated: now - 30 * H,
  ...extra,
});
let branches: Branch[] = [
  br("main", "local", { isHead: true, upstream: "origin/main", ahead: 1, updated: now - 2 * H }),
  br("feature/theme", "local", { upstream: "origin/feature/theme", behind: 2, updated: now - 5 * H }),
  br("feature/command-palette", "local", { updated: now - 50 * H }),
  br("fix/graph-perf", "local", { updated: now - 26 * H }),
  br("fix/windows-titlebar", "local", { updated: now - 120 * H }),
  br("release/0.2", "local", { updated: now - 300 * H }),
  br("origin/main", "remote", { updated: now - 3 * H }),
  br("origin/feature/theme", "remote", { updated: now - 6 * H }),
  br("origin/feature/auth", "remote", { updated: now - 90 * H }),
  br("origin/docs/getting-started", "remote", { updated: now - 200 * H }),
  br("v0.2.0", "tag", { updated: now - 80 * H }),
  br("v0.1.0", "tag", { updated: now - 700 * H }),
];

let tree: TreeEntry[] = [
  ".github", ".github/workflows", "docs", "public", "src", "src/assets", "src/lib", "src/lib/components", "src-tauri", "src-tauri/src",
].map((path) => ({ path, dir: true }));
tree.push(
  ...[
    ".gitignore", "README.md", "package.json", "tsconfig.json", "vite.config.ts", ".github/workflows/build.yml",
    "docs/architecture.md", "docs/old-architecture.md", "public/favicon.svg", "src/app.css", "src/App.svelte", "src/main.ts",
    "src/assets/orbe-mark.svg", "src/lib/api.ts", "src/lib/graph.ts", "src/lib/format.ts", "src/lib/state.svelte.ts",
    "src/lib/components/CommitGraph.svelte", "src/lib/components/Sidebar.svelte", "src/lib/components/Toolbar.svelte",
    "src/lib/components/DiffView.svelte", "src/lib/components/Toasts.svelte", "src-tauri/Cargo.toml",
    "src-tauri/tauri.conf.json", "src-tauri/src/main.rs", "src-tauri/src/lib.rs", "src-tauri/src/git.rs",
  ].map((path) => ({ path, dir: false })),
);

const FENCE = "`".repeat(3);

function sampleFile(path: string): string {
  if (path.endsWith(".md"))
    return `# ${path.split("/").pop()?.replace(".md", "")}\n\nOrbe is a calm, beautiful Git client.\n\n## Getting started\n\n${FENCE}bash\npnpm install\npnpm tauri dev\n${FENCE}\n`;
  if (path.endsWith(".json")) return `{\n  "name": "aurora",\n  "version": "0.2.0",\n  "private": true\n}\n`;
  if (path.endsWith(".rs"))
    return `use tauri::Manager;\n\n/// Entry point for the desktop app.\npub fn run() {\n    tauri::Builder::default()\n        .run(tauri::generate_context!())\n        .expect("error while running");\n}\n`;
  return Array.from({ length: 48 }, (_, i) =>
    i === 0 ? `// ${path}` : i % 7 === 0 ? "" : `${"  ".repeat(i % 3)}export const value${i} = compute(${i}, "${path.split("/").pop()}");`,
  ).join("\n");
}

const AI_REPLIES = {
  commit:
    "Refine theme tokens and graph rendering\n\n- Move the accent palette to OKLCH tokens so every surface derives from one hue\n- Reuse free lanes in the commit graph to keep it compact\n- Add the new toast component",
  default: `Here's a summary of your work in progress:\n\n**Theme**: \`app.css\` switches the accent colours to OKLCH, so every accent now derives from a single hue.\n\n**Graph**: \`graph.ts\` reuses free lanes, which keeps wide histories compact.\n\n**New files**: \`Toasts.svelte\` is new and not yet staged.\n\nSuggested next step: commit the theme change separately from the graph change.\n\n${FENCE}bash\ngit add src/lib/components/Toasts.svelte\n${FENCE}`,
};

function diffFor(file: string, kind: string): string {
  if (kind === "untracked" || kind === "added") {
    return `diff --git a/${file} b/${file}
new file mode 100644
--- /dev/null
+++ b/${file}
@@ -0,0 +1,14 @@
+<script lang="ts">
+  import { toasts } from "../state.svelte";
+</script>
+
+<div class="toasts">
+  {#each toasts.items as toast (toast.id)}
+    <div class="toast" data-kind={toast.kind}>
+      {toast.message}
+    </div>
+  {/each}
+</div>
+
+<style>
+</style>
`;
  }
  if (kind === "deleted") {
    return `diff --git a/${file} b/${file}
deleted file mode 100644
--- a/${file}
+++ /dev/null
@@ -1,6 +0,0 @@
-# Architecture (legacy)
-
-This document described the Electron prototype.
-It has been superseded by the Tauri architecture.
-
-See docs/architecture.md instead.
`;
  }
  if (file.endsWith(".css")) {
    return `diff --git a/${file} b/${file}
--- a/${file}
+++ b/${file}
@@ -12,9 +12,11 @@ @theme {
   /* Brand */
-  --color-accent: oklch(0.68 0.22 300);
-  --color-accent-strong: oklch(0.6 0.24 300);
+  --color-accent: oklch(0.7 0.25 328);
+  --color-accent-strong: oklch(0.62 0.27 328);
+  --color-accent-fg: oklch(0.86 0.12 328);
+  --color-accent-soft: oklch(0.7 0.25 328 / 0.14);

   /* Semantic */
   --color-added: oklch(0.78 0.16 155);
   --color-deleted: oklch(0.7 0.19 15);
   --color-modified: oklch(0.82 0.14 80);
`;
  }
  return `diff --git a/${file} b/${file}
--- a/${file}
+++ b/${file}
@@ -18,14 +18,19 @@ export function layoutGraph(commits: Commit[]): GraphRow[] {
   const lanes: (string | null)[] = [];
   const rows: GraphRow[] = [];

-  for (let i = 0; i < commits.length; i++) {
-    const commit = commits[i];
-    let lane = lanes.indexOf(commit.hash);
+  for (const commit of commits) {
+    let lane = lanes.indexOf(commit.hash);
     if (lane === -1) {
-      lane = lanes.length;
-      lanes.push(commit.hash);
+      // Reuse the first free lane to keep the graph compact.
+      lane = lanes.indexOf(null);
+      if (lane === -1) lane = lanes.length;
+      lanes[lane] = commit.hash;
     }

     const before = lanes.slice();
+    const color = laneColor(lane);
+
+    // Every lane that was waiting for this commit converges here.
     for (let j = 0; j < lanes.length; j++) {
       if (lanes[j] === commit.hash) lanes[j] = null;
     }
`;
}

function commitFiles(hashValue: string): FileChange[] {
  const n = parseInt(hashValue.slice(0, 2), 16);
  const pool: FileChange[] = [
    { path: "src/lib/graph.ts", oldPath: null, status: "modified", staged: false },
    { path: "src/app.css", oldPath: null, status: "modified", staged: false },
    { path: "src/lib/components/Sidebar.svelte", oldPath: null, status: "modified", staged: false },
    { path: "src/lib/components/Toasts.svelte", oldPath: null, status: "added", staged: false },
    { path: "docs/old-architecture.md", oldPath: null, status: "deleted", staged: false },
    { path: "src/lib/components/DiffView.svelte", oldPath: "src/lib/Diff.svelte", status: "renamed", staged: false },
    { path: "package.json", oldPath: null, status: "modified", staged: false },
  ];
  const count = 1 + (n % 5);
  return pool.slice(n % 3, (n % 3) + count);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mock<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  await wait(cmd === "get_log" ? 220 : 90);
  const a = args as Record<string, any>;

  switch (cmd) {
    case "open_repo":
      return { path: a.path, name: String(a.path).split(/[\\/]/).pop(), head: "main" } as T;
    case "get_status":
      return structuredClone(status) as T;
    case "get_log":
      return commits.slice(0, a.limit) as T;
    case "get_branches":
      return structuredClone(branches) as T;
    case "get_file_diff": {
      const entry = status.find((s) => s.path === a.file);
      return diffFor(a.file, entry?.status ?? "modified") as T;
    }
    case "get_commit_files":
      return commitFiles(a.hash) as T;
    case "get_commit_file_diff": {
      const f = commitFiles(a.hash).find((x) => x.path === a.file);
      return diffFor(a.file, f?.status ?? "modified") as T;
    }
    case "stage_files":
      status = status.map((s) => ((a.files as string[]).includes(s.path) ? { ...s, staged: true, status: s.status === "untracked" ? "added" : s.status } : s));
      return undefined as T;
    case "unstage_files":
      status = status.map((s) => ((a.files as string[]).includes(s.path) ? { ...s, staged: false, status: s.status === "added" ? "untracked" : s.status } : s));
      return undefined as T;
    case "discard_files": {
      const gone = new Set([...(a.tracked as string[]), ...(a.untracked as string[])]);
      status = status.filter((s) => s.staged || !gone.has(s.path));
      return undefined as T;
    }
    case "commit": {
      const head = commits.find((c) => c.refs.some((r) => r.startsWith("HEAD")))!;
      head.refs = head.refs.filter((r) => !r.startsWith("HEAD"));
      const h = hash();
      commits = [
        {
          hash: h,
          shortHash: h.slice(0, 7),
          parents: [head.hash],
          author: AUTHORS[0][0],
          email: AUTHORS[0][1],
          timestamp: Math.floor(Date.now() / 1000),
          subject: String(a.message).split("\n")[0],
          refs: ["HEAD -> main"],
        },
        ...commits,
      ];
      status = status.filter((s) => !s.staged);
      branches[0].ahead++;
      return h.slice(0, 7) as T;
    }
    case "checkout_branch": {
      await wait(250);
      let name = a.name as string;
      if (a.remote) {
        name = name.split("/").slice(1).join("/");
        if (!branches.some((b) => b.kind === "local" && b.name === name))
          branches.push(br(name, "local", { upstream: a.name, updated: now }));
      }
      branches.forEach((b) => (b.isHead = b.kind === "local" && b.name === name));
      return undefined as T;
    }
    case "create_branch":
      if (branches.some((b) => b.kind === "local" && b.name === a.name))
        throw new Error(`A branch named '${a.name}' already exists.`);
      branches.push(br(a.name, "local", { updated: Math.floor(Date.now() / 1000) }));
      if (a.checkout) branches.forEach((b) => (b.isHead = b.kind === "local" && b.name === a.name));
      return undefined as T;
    case "rename_branch":
      branches = branches.map((b) => (b.kind === "local" && b.name === a.old ? { ...b, name: a.new } : b));
      return undefined as T;
    case "delete_branch":
    case "delete_remote_branch":
      branches = branches.filter((b) => b.name !== a.name || b.kind === "tag");
      return undefined as T;
    case "create_tag":
      branches.push(br(a.name, "tag", { updated: Math.floor(Date.now() / 1000) }));
      return undefined as T;
    case "delete_tag":
      branches = branches.filter((b) => !(b.kind === "tag" && b.name === a.name));
      return undefined as T;
    case "merge_branch":
    case "stash_save":
    case "stash_pop":
    case "init_repo":
      return undefined as T;
    case "clone_repo":
      await wait(900);
      return a.dest as T;
    case "get_staged_diff":
    case "get_working_diff":
      return status.map((s) => diffFor(s.path, s.status)).join("\n") as T;
    case "get_commit_patch":
      return commitFiles(a.hash).map((f) => diffFor(f.path, f.status)).join("\n") as T;
    case "list_tree":
      return structuredClone(tree) as T;
    case "read_file": {
      const text = sampleFile(a.file);
      return { text, binary: false, size: text.length, truncated: false } as T;
    }
    case "create_file":
    case "create_folder": {
      const p = (a.file ?? a.folder) as string;
      if (tree.some((t) => t.path === p)) throw new Error(`${p} already exists.`);
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join("/");
        if (!tree.some((t) => t.path === dir)) tree.push({ path: dir, dir: true });
      }
      tree.push({ path: p, dir: cmd === "create_folder" });
      if (cmd === "create_file") status.push({ path: p, oldPath: null, status: "untracked", staged: false });
      return undefined as T;
    }
    case "rename_path":
      tree = tree.map((t) =>
        t.path === a.from || t.path.startsWith(a.from + "/") ? { ...t, path: a.to + t.path.slice(a.from.length) } : t,
      );
      return undefined as T;
    case "delete_path":
      tree = tree.filter((t) => t.path !== a.target && !t.path.startsWith(a.target + "/"));
      return undefined as T;
    case "chats_load":
      return localStorage.getItem(`orbe.demoChats.${a.repo}`) as T;
    case "chats_save":
      localStorage.setItem(`orbe.demoChats.${a.repo}`, a.data);
      return undefined as T;
    case "ai_set_key":
      localStorage.setItem(`orbe.demoKey.${a.provider}`, "1");
      return undefined as T;
    case "ai_has_key":
      return (localStorage.getItem(`orbe.demoKey.${a.provider}`) === "1") as T;
    case "ai_clear_key":
      localStorage.removeItem(`orbe.demoKey.${a.provider}`);
      return undefined as T;
    case "ai_list_models":
      return (a.config.provider === "anthropic" ? ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] : []) as T;
    case "ai_cli_version":
      return (a.provider === "claude-code" ? "2.1.0 (Claude Code)" : null) as T;
    case "ai_complete": {
      await wait(1100);
      return (String(a.system).startsWith("You write Git commit messages") ? AI_REPLIES.commit : AI_REPLIES.default) as T;
    }
    case "fetch":
    case "pull":
    case "push":
      await wait(700);
      if (cmd === "push") branches[0].ahead = 0;
      return undefined as T;
    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}

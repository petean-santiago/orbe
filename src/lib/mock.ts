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
  const themeLocal = theme; // local feature/theme is 2 commits behind its remote
  perf = add("Render graph lanes on demand", [perf], 1);
  theme = add("Add vibrancy to the sidebar", [theme], 0);
  main = add("Merge branch 'fix/graph-perf'", [main, perf], 1);
  const release = add("Release v0.2.0", [main], 2);
  main = release;
  theme = add("Animate panel transitions", [theme], 0);
  main = add("Show ahead/behind counters", [main], 3);

  const byHash = new Map(list.map((c) => [c.hash, c]));
  // main is 1 commit ahead of origin/main; feature/theme is 2 behind origin/feature/theme.
  byHash.get(main)!.refs = ["HEAD -> main", "develop", "feature/testing", "tag: v0.3.0-beta"];
  byHash.get(release)!.refs = ["origin/main", "origin/develop", "tag: v0.2.0"];
  byHash.get(theme)!.refs = ["origin/feature/theme"];
  byHash.get(themeLocal)!.refs = ["feature/theme"];

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
  { path: "src/assets/hero.png", oldPath: null, status: "modified", staged: false },
];

// `?demo&conflict` starts the demo repository half-way through a merge with conflicts.
const demoConflict = typeof location !== "undefined" && new URLSearchParams(location.search).has("conflict");
// `?demo&sso` makes the first push fail the way GitHub does when SAML SSO isn't authorized yet.
let ssoPending = typeof location !== "undefined" && new URLSearchParams(location.search).has("sso");
let operation: "merge" | null = demoConflict ? "merge" : null;

/** Which sides git kept for each demo conflict (a missing side deleted the file). */
const CONFLICTS: Record<string, { base: boolean; ours: boolean; theirs: boolean }> = {
  "src/lib/theme.ts": { base: true, ours: true, theirs: true },
  "docs/setup.md": { base: true, ours: true, theirs: false },
  "src/assets/logo.png": { base: true, ours: true, theirs: true },
};

const THEME_CONFLICT = `/**
 * Theme tokens shared by every component.
 */
export interface Theme {
  accent: string;
  radius: number;
<<<<<<< HEAD
  glass: "frosted" | "clear" | "solid";
=======
  glass: boolean;
  blur: number;
>>>>>>> feature/theme
}

export const defaults: Theme = {
  accent: "oklch(0.7 0.25 330)",
  radius: 12,
  glass: "frosted",
};

export function applyTheme(theme: Theme, root: HTMLElement) {
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--radius", \`\${theme.radius}px\`);
  root.dataset.glass = theme.glass;
}

export function mix(a: string, b: string, amount = 0.5): string {
  return \`color-mix(in oklch, \${a} \${amount * 100}%, \${b})\`;
}

export function contrast(color: string): "light" | "dark" {
  const l = Number(/oklch\(([\d.]+)/.exec(color)?.[1] ?? 0.5);
  return l > 0.6 ? "dark" : "light";
}

export function describe(theme: Theme): string {
<<<<<<< HEAD
  return \`\${theme.accent} · \${theme.glass} glass\`;
=======
  const glass = theme.glass ? \`glass \${theme.blur}px\` : "no glass";
  return \`\${theme.accent} · \${glass}\`;
>>>>>>> feature/theme
}

export const PRESETS = ["fuchsia", "violet", "ocean"] as const;
`;

/** Files saved through the conflict editor. */
const written = new Map<string, string>();

if (demoConflict) {
  status = [
    ...Object.keys(CONFLICTS).map((path): FileChange => ({ path, oldPath: null, status: "conflicted", staged: false })),
    { path: "src/lib/components/Ambient.svelte", oldPath: null, status: "modified", staged: true },
    { path: "src/app.css", oldPath: null, status: "modified", staged: true },
  ];
}

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
  br("develop", "local", { upstream: "origin/develop", ahead: 1, updated: now - 2 * H }),
  br("feature/testing", "local", { updated: now - 2 * H }),
  br("origin/develop", "remote", { updated: now - 2 * H }),
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
    "docs/architecture.md", "docs/old-architecture.md", "docs/screenshot.png", "docs/manual.pdf", "public/favicon.svg", "src/app.css", "src/App.svelte", "src/main.ts",
    "src/assets/orbe-mark.svg", "src/assets/hero.png", "src/lib/api.ts", "src/lib/graph.ts", "src/lib/format.ts", "src/lib/state.svelte.ts",
    "src/lib/components/CommitGraph.svelte", "src/lib/components/Sidebar.svelte", "src/lib/components/Toolbar.svelte",
    "src/lib/components/DiffView.svelte", "src/lib/components/Toasts.svelte", "src-tauri/Cargo.toml",
    "src-tauri/tauri.conf.json", "src-tauri/src/main.rs", "src-tauri/src/lib.rs", "src-tauri/src/git.rs",
  ].map((path) => ({ path, dir: false })),
);

const FENCE = "`".repeat(3);

const DEMO_IMG_OLD = "iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAYAAAABtjuPAAAPbUlEQVR42u3c23Ja6Z2G8VyG9vu9LCEUKVKkSLFjx47dCNEgaBA0CLKAFXYBhmHuOHeQkzlh3nnq7UoqVZmqmbHccvy9Vb/z7+A5XOv/i1+EhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhX3zO577NPtvCXw3O7HkXAqnuJv90s7m0jjH/exXdjGXwSW+n/3aruayuEZu9hu7mXvALfKz39rruQLe4IfZ7+ztXBHvUJr93t7PPeIDyrM/2Me5Cj7hx9l3lpqr4g61Wdru556QQX32vWXnGsjhj7MHy89FKKA5+8GKcy2U0J49WnkuRgV/mv1o1bkOaujOnqw+10MD/dkfLZoboIk/z1rWnhsixmj2J+vMjdHFv8161p+bYIB/n/3ZhnNTjPAfsxBgCDAEGAIMAT5fgPMKUBJQfJacT+EUis/O5tM4h+Kzi/kMLqH47Go+i2soPruZf8AtFJ+9ni/gDRSfvZ0v4h0Un72ff8QHKD77OF/BJyg+S81XcQfFZ/fzT8hA8Vl2voEcFJ/l5yMUoPisON9CCYrPyvMxKlB8Vp3voAbFZ/X5HhpQfBbND9CE4rP2/BAxFJ915sfoQvFZf36CARSfDeenGCEEGAIMAYYAQ4DPGeCCApQEFJ8lF1I4heKzs4U0zqH47GIhg0soPrtayOIais9uFh5wC8VnrxcKeAPFZ28XingHxWfvFx7xAYrPPi5U8AmKz1ILVdxB8dn9whMyUHyWXWggB8Vn+YUIBSg+Ky60UILis/JCjAoUn1UXOqhB8Vl9oYcGFJ9FCwM0ofisvTBEDMVnnYUxulB81l+YYADFZ8OFKUYIAYYAQ4AhwBDgcwa4qAAlAcVnycUUTqH47GwxjXMoPrtYzOASis+uFrO4huKzm8UH3ELx2evFAt5A8dnbxSLeQfHZ+8VHfIDis4+LFXyC4rPUYhV3UHx2v/iEDBSfZRcbyEHxWX4xQgGKz4qLLZSg+Ky8GKMCxWfVxQ5qUHxWX+yhAcVn0eIATSg+ay8OEUPxWWdxjC4Un/UXJxhA8dlwcYoRQoAhwBBgCDAE+JwBLilASUDxWXIphVMoPjtbSuMcis8uljK4hOKzq6UsrqH47GbpAbdQfPZ6qYA3UHz2dqmId1B89n7pER+g+OzjUgWfoPgstVTFHRSf3S89IQPFZ9mlBnJQfJZfilCA4rPiUgslKD4rL8WoQPFZdamDGhSf1Zd6aEDxWbQ0QBOKz9pLQ8RQfNZZGqMLxWf9pQkGUHw2XJpihBBgCDAEGAIMAT5ngMsKUBJQfJZcTuEUis/OltM4h+Kzi+UMLqH47Go5i2soPrtZfsAtFJ+9Xi7gDRSfvV0u4h0Un71ffsQHKD77uFzBJyg+Sy1XcQfFZ/fLT8hA8Vl2uYEcFJ/llyMUoPisuNxCCYrPyssxKlB8Vl3uoAbFZ/XlHhpQfBYtD9CE4rP28hAxFJ91lsfoQvFZf3mCARSfDZenGCEEGAIMAb6MAP/y+Jf/tRDg1xDgigKUBBSfJVdSOIXis7OVNM6h+OxiJYNLKD67WsniGorPblYecAvFZ69XCngj/5fo/pnvVn5EaqWKOyg+u195QgaKz7IrDeSg+Cy/EqEAxWfFlRZKUHxWXolRgeKz6koHNSg+q6/00IDis2hlgCYUn7VXhoih+KyzMkYXis/6KxMMoPhsuDLFCN9ogJ8zvH8UAgwB/o8BPmd8fx9hCPClBLiqACUBxWfJ1RROofjsbDWNcyg+u1jN4BKKz65Ws7iG4rOb1QfcQvGtfpn4fnK3qgBXFZ/drz4hA8Vn2dUGclB8ll+NUIDis+JqCyUoPiuvxqhA8Vl1tYMaFJ/VV3toQPFZtDpAE4rP2qtDxFB81lkdowvFZ/3VCQZQfDZcnWKEbyTALxnePwoBfuMB/pzx/X2EIcCfK8A1BSgJKD5LrqVwCsVnZ2tpnEPx2cVaBpdQfHa1lsU1FJ/drD3gRQS4pgDXnpCB4rPsWgM5KD7Lr0UoQPFZca2FEhSflddiVKD4rLrWQQ2Kz+prPTSg+CxaG6AJxWfttSFiKD7rrI3RheKz/toEAyg+G65NMcK/eIAvIb6fhAC/sQBfUnx/H2EI8EsHuK4AJQHFZ8n1FE6h+OxsPY1zKD67WM/gEorPrtazuIbiW3+Z8f0ks64A1xWfZdcbyEHxWX49QgGKz4rrLZSg+Ky8HqMCxWfV9Q5qUHxWX++hAcVn0foATSg+a68PEUPxWWd9jC4Un/XXJxhA8dlwfYoRQoAhwBDg5w3wJcf3twhDgF8uwA0FKAkoPktupHAKxWdnG2mcQ/HZxUYGl1B8drWRxTW+kgA3FJ9lNxrIQfFZfiNCAYrPihstlKD4rLwRowLFZ9WNDmpQfFbf6KEBxWfRxgBNKD5rbwwRQ/FZZ2OMLhSf9TcmGEDx2XBjihFCgCHAEODnC/BriO8nIcAvFeCmApQEFJ8lN1M4heKzs800zqH47GIzg0soPrvazOJ68ysLcLOO7GYDOSg+y29GKEDxWXGzhRIUn5U3Y1Sg+Ky62UENis/qmz00oPgs2hygCcVn7c0hYig+62yO0YXis/7mBAMoPhtuTjFCCDAEGAIMAYYAnzPALQUoCSg+S26lcArFZ2dbaZxD8dnFVgaXUHx2tZXF9dZXFuBWHdmtBnJQfJbfilCA4rPiVgslKD4rb8WoQPFZdauDGhSf1bd6aEDxWbQ1QBOKz9pbQ8RQfNbZGqMLxWf9rQkGUHw23JpihBBgCDAEGAIMAT5ngNsKUBJQfJbcTuEUis/OttM4h+Kzi+0MLqH47Go7i+vtryzA7Tqy2w3koPgsvx2hAMVnxe0WSlB8Vt6OUYHis+p2BzUoPqtv99CA4rNoe4AmFJ+1t4eIofissz1GF4rP+tsTDKD4bLg9xQghwBBgCDAEGAJ8zgB3FKAkoPgsuZPCKRSfne2kcQ7FZxc7GVxC8dnVThbXO19ZgDt1ZHcayEHxWX4nQgGKz4o7LZSg+Ky8E6MCxWfVnQ5qUHxW3+mhAcVn0c4ATSg+a+8MEUPxWWdnjC4Un/V3JhhA8dlwZ4oRQoAhwBBgCDAE+JwB7ipASUDxWXI3hVMoPjvbTeMcis8udjO4hOKzq90srvGVfA2zq/gsu9tADorP8rsRClB8VtxtoQTFZ+XdGBUoPqvudlCD4rP6bg8NKD6LdgdoQvFZe3eIGIrPOrtjdKH4rL87wQCKz4a7U4wQAgwBhgBDgCHA5wxwTwFKAorPknspnELx2dleGudQfHaxl8ElFJ9d7WVxjdzsN3sv/J+QvSdRfJbdayAHxWf5vQgFKD4r7rVQguKz8l6MChSfVfc6qEHxWX2vhwYUn0V7AzSh+Ky9N0QMxWedvTG6UHzW35tgAMVnw70pRggBhgBDgJ8/wJca4T3xhQC/bID7ClASUHyW3E/hFIrPzvbTOIfis4v9DC6h+OxqP4trKD672X9hlxH2n5CB4rPsfgM5KD7L70coQPFZcb+FEhSflfdjVKD4rLrfQQ2Kz+r7PTSg+CzaH6AJxWft/SFiKD7r7I/RheKz/v4EAyg+G+5PMcK/eIAvJcL0fi0EGAIMAX6bAR4oQElA8VnyIIVTKD47O0jjHIrPLg4yuITis6uDLK6h+Ozm4AG3Bz/zfcCDGu4PnpCB4rPsQQM5KD7LH0QoQPFZ8aCFEhSflQ9iVKD4rHrQQQ2Kz+oHPTSg+Cw6GKAJxWftgyFiKD7rHIzRheKz/sEEAyg+Gx5MMcI3EuDtQX7224MvfCH1oCq1EGAI8G8BfqkIU8QXAnwZAR4qQElA8VnyMIVTKD47O0zjHIrPLg4zuITis6vDLK6h+Ozm8AG3UHz2+vCZr+QfVnEHxWf3h0/IQPFZ9rCBHBSf5Q8jFKD4rHjYQgmKz8qHMSpQfFY97KAGxWf1wx4aUHwWHQ7QhOKz9uEQMRSfdQ7H6ELxWf9wggEUnw0PpxjhBQT417/+58/mc4b3ud8WAvwGAvz/xvic7wkBfq4AXylASUDxWfJVCi8lwJcm/ypCAYrPiq9aKEHxWflVjAoUn1VfdVCD4rP6qx4aUHwWvRqgCcVn7VdDxFB81nk1RheKz/qvJhhA8dnw1RQjhABDgCHAEFsI8DkDPFKAkoDis+RRCiG2fxLgUYQCFJ8Vj1ooQfFZ+ShGBYrPqkcd1KD4rH7UQwOKz6KjAZpQfNY+GiKG4rPO0RhdKD7rH00wgOKz4dEUI7yAAE9xN/ulnR2lcY772a/s4iiDS3w/+7VdHWVxjdzsN3Zz9IBb5Ge/tddHBbzBD7Pf2dujIt6hNPu9vT96xAeUZ3+wj0cVfMKPs+8sdVTFHWqztN0fPSGD+ux7yx41kMMfZw8WAgwBhgD/JQI8VoCSgOKz5HEKp1B8dnacxjkUn10cZ3AJxWdXx1lcQ/HZzfEDbqH47PVxAW+g+OztcRHvoPjs/fEjPkDx2cfjCj5B8VnquIo7KD67P35CBorPsscN5KD4LH8coQDFZ8XjFkpQfFY+jlGB4rPqcQc1KD6rH/fQgOKz6HiAJhSftY+HiKH4rHM8RheKz/rHEwyg+Gx4PMUIIcAQYAgwBBgCfM4AEwpQElB8lkykcArFZ2eJNM6h+OwikcElFJ9dJbK4huKzm8QDbqH47HWigDdQfPY2UcQ7KD57n3jEByg++5io4BMUn6USVdxB8dl94gkZKD7LJhrIQfFZPhGhAMVnxUQLJSg+KydiVKD4rJrooAbFZ/VEDw0oPosSAzSh+KydGCKG4rNOYowuFJ/1ExMMoPhsmJhihBBgCDAEGAIMAT5ngCcKUBJQfJY8SeEUis/OTtI4h+Kzi5MMLqH47Ooki2soPrs5ecAtFJ+9PingDRSfvT0p4h0Un70/ecQHKD77eFLBJyg+S51UcQfFZ/cnT8hA8Vn2pIEcFJ/lTyIUoPiseNJCCYrPyicxKlB8Vj3poAbFZ/WTHhpQfBadDNCE4rP2yRAxFJ91TsboQvFZ/2SCARSfDU+mGCEEGAIMAYYAQ4DPGWBSAUoCis+SyRROofjsLJnGORSfXSQzuITis6tkFtdQfHaTfMAtFJ+9ThbwBorP3iaLeAfFZ++Tj/gAxWcfkxV8guKzVLKKOyg+u08+IQPFZ9lkAzkoPssnIxSg+KyYbKEExWflZIwKFJ9Vkx3UoPisnuyhAcVnUXKAJhSftZNDxFB81kmO0YXis35yggEUnw2TU4zwBQIMCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLC3vx+y9hDQhH6a8rtgAAAABJRU5ErkJggg==";
const DEMO_IMG_NEW = "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";
const DEMO_PNG = "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EDGGGSHOKAnGGGeCSaZIMk2KGWaZI808CyyyRIZlVlhljXU22GSLLDnybLPDLgX22OeAIoccUeKYE04pc0aFc6pccMkV19S44ZY77nmgziNPNHimSYs2L7zyRod3Pvjk69++A/5dAF10EyBIDyHC9NJHPxGiDDDIEDGGGSHOKAnGGGeCSaZIMk2KGWaZI808CyyyRIZlVlhljXU22GSLLDnybLPDLgX22OeAIoccUeKYE04pc0aFc6pccMkV19S44ZY77nmgziNPNHimSYs2L7zyRod3Pvjk69+/A/5DAF10EyBIDyHC9NJHPxGiDDDIEDGGGSHOKAnGGGeCSaZIMk2KGWaZI808CyyyRIZlVlhljXU22GSLLDnybLPDLgX22OeAIoccUeKYE04pc0aFc6pccMkV19S44ZY77nmgziNPNHimSYs2L7zyRod3Pvjk6z++A/5TAF10EyBIDyHC9NJHPxGiDDDIEDGGGSHOKAnGGGeCSaZIMk2KGWaZI808CyyyRIZlVlhljXU22GSLLDnybLPDLgX22OeAIoccUeKYE04pc0aFc6pccMkV19S44ZY77nmgziNPNHimSYs2L7zyRod3Pvjk6z+/A/6PALroJkCQHkKE6aWPfiJEGWCQIWIMM0KcURKMMc4Ek0yRZJoUM8wyR5p5FlhkiQzLrLDKGutssMkWWXLk2WaHXQrssc8BRQ45osQxJ5xS5owK51S54JIrrqlxwy133PNAnUeeaPBMkxZtXnjljQ7vfPDJF/8ftCkT0F46okcAAAAASUVORK5CYII=";
const DEMO_PDF = "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAxMDMgPj4Kc3RyZWFtCkJUIC9GMSAyOCBUZiA3MiA3MjAgVGQgKE9yYmUgbWFudWFsKSBUaiBFVApCVCAvRjEgMTQgVGYgNzIgNjkwIFRkIChBIGNhbG0sIGJlYXV0aWZ1bCBHaXQgY2xpZW50LikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzOTUgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0NjUKJSVFT0YK";

function sampleFile(path: string): string {
  if (path.endsWith(".svg"))
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><defs><radialGradient id="o" cx=".35" cy=".3"><stop offset="0" stop-color="#fdf0ff"/><stop offset=".5" stop-color="#d946ef"/><stop offset="1" stop-color="#3b0640"/></radialGradient></defs><ellipse cx="60" cy="44" rx="52" ry="14" fill="none" stroke="#f5d0fe" stroke-width="3" transform="rotate(-18 60 44)"/><circle cx="60" cy="40" r="26" fill="url(#o)"/></svg>`;
  if (path === "README.md")
    return `# Aurora

A calm, **beautiful** Git client. See the [architecture notes](docs/architecture.md).

![Screenshot](docs/screenshot.png)

## Features

| Feature | Status |
| --- | --- |
| Commit graph | Done |
| AI assistant | Beta |
| Drag to merge | Done |

## Roadmap

- [x] Tabs
- [x] Syntax highlighting
- [ ] Blame view

> Built with Tauri, Rust and Svelte.

${FENCE}ts
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
${FENCE}
`;
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
  conflicts: [
    "### CONFLICT 1",
    "decision: merged",
    "reason: Keeps the new glass styles from current and adds the blur amount from incoming.",
    "<<<RESOLUTION",
    '  glass: "frosted" | "clear" | "solid";',
    "  blur: number;",
    "RESOLUTION>>>",
    "",
    "### CONFLICT 2",
    "decision: unsure",
    "reason: Incoming treats glass as on/off, current as a style name; which wording you want is a product choice.",
  ].join("\n"),
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
    case "check_remote_access":
    case "store_credential":
      return undefined as T;
    case "get_commit_people": {
      const c = commits.find((x) => x.hash === a.hash);
      const name = c?.author ?? AUTHORS[0][0];
      const email = c?.email ?? AUTHORS[0][1];
      const t = c?.timestamp ?? 0;
      // Every fifth commit looks rebased by someone else, to show the committer row.
      const other = parseInt(String(a.hash).slice(0, 2), 16) % 5 === 0 ? AUTHORS[1] : null;
      return {
        author: name,
        authorEmail: email,
        authorTime: t,
        committer: other ? other[0] : name,
        committerEmail: other ? other[1] : email,
        committerTime: other ? t + 3600 : t,
      } as T;
    }
    case "get_commit_files":
      return commitFiles(a.hash) as T;
    case "get_commit_file_diff": {
      const f = commitFiles(a.hash).find((x) => x.path === a.file);
      return diffFor(a.file, f?.status ?? "modified") as T;
    }
    case "stage_files":
      status = status.map((s) =>
        (a.files as string[]).includes(s.path)
          ? { ...s, staged: true, status: s.status === "untracked" ? "added" : s.status === "conflicted" ? "modified" : s.status }
          : s,
      );
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
      // Move the HEAD marker in the history to the branch tip.
      for (const c of commits) {
        c.refs = c.refs.flatMap((r) => (r === "HEAD" ? [] : r.startsWith("HEAD -> ") ? [r.slice(8)] : [r]));
        c.refs = c.refs.map((r) => (r === name ? `HEAD -> ${name}` : r));
      }
      return undefined as T;
    }
    case "checkout_commit": {
      await wait(250);
      branches.forEach((b) => (b.isHead = false));
      for (const c of commits) {
        c.refs = c.refs.flatMap((r) => (r === "HEAD" ? [] : r.startsWith("HEAD -> ") ? [r.slice(8)] : [r]));
        if (c.hash === a.hash) c.refs = ["HEAD", ...c.refs];
      }
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
    case "merge_into": {
      await wait(300);
      branches.forEach((b) => (b.isHead = b.kind === "local" && b.name === a.target));
      return "merged" as T;
    }
    case "rebase_onto":
      await wait(300);
      branches.forEach((b) => (b.isHead = b.kind === "local" && b.name === a.branch));
      return "rebased" as T;
    case "repo_operation":
      return operation as T;
    case "continue_operation":
      if (status.some((s) => s.status === "conflicted")) throw new Error("You must resolve all conflicts first.");
      operation = null;
      status = status.filter((s) => !s.staged);
      return undefined as T;
    case "abort_operation":
      operation = null;
      status = status.filter((s) => !s.staged && s.status !== "conflicted");
      return undefined as T;
    case "get_conflict_info": {
      const c = CONFLICTS[a.file] ?? { base: true, ours: true, theirs: true };
      return { ...c, oursLabel: "main", theirsLabel: "feature/theme" } as T;
    }
    case "resolve_conflict": {
      const keepsFile = CONFLICTS[a.file]?.[a.side === "ours" ? "ours" : "theirs"] ?? true;
      status = status.map((s) =>
        s.path === a.file && s.status === "conflicted" ? { ...s, staged: true, status: keepsFile ? "modified" : "deleted" } : s,
      );
      return undefined as T;
    }
    case "write_file":
      written.set(a.file, a.content);
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
      if (written.has(a.file)) {
        const text = written.get(a.file)!;
        return { text, binary: false, size: text.length, truncated: false } as T;
      }
      if (a.file === "src/lib/theme.ts" && demoConflict)
        return { text: THEME_CONFLICT, binary: false, size: THEME_CONFLICT.length, truncated: false } as T;
      if (/\.(png|pdf)$/.test(a.file)) return { text: null, binary: true, size: 18_432, truncated: false } as T;
      const text = sampleFile(a.file);
      return { text, binary: false, size: text.length, truncated: false } as T;
    }
    case "read_blob_base64":
      return (String(a.spec).includes("hero.png") ? DEMO_IMG_OLD : DEMO_PNG) as T;
    case "read_file_base64":
      if (String(a.file).endsWith("hero.png")) return DEMO_IMG_NEW as T;
      // Small real files so image and PDF previews work in the browser demo.
      return (String(a.file).endsWith(".pdf") ? DEMO_PDF : DEMO_PNG) as T;
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
      if (String(a.system).startsWith("You resolve Git merge conflicts")) return AI_REPLIES.conflicts as T;
      return (String(a.system).startsWith("You write Git commit messages") ? AI_REPLIES.commit : AI_REPLIES.default) as T;
    }
    case "fetch":
    case "pull":
    case "push":
      await wait(700);
      if (cmd === "push" && ssoPending) {
        ssoPending = false;
        throw {
          kind: "sso",
          message:
            "remote: The 'acme' organization has enabled or enforced SAML SSO.\nremote: To access this repository, visit https://github.com/orgs/acme/sso?authorization_request=DEMO and try again.\nfatal: unable to access 'https://github.com/acme/aurora.git/': The requested URL returned error: 403",
          url: "https://github.com/orgs/acme/sso?authorization_request=DEMO",
          host: "github.com",
          remote: "origin",
          transport: "https",
        };
      }
      if (cmd === "push") branches[0].ahead = 0;
      return undefined as T;
    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}

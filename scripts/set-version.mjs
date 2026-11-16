// Set the Orbe version in the three places that hold it.
//   pnpm version:set 0.3.0
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: pnpm version:set <major.minor.patch>   e.g. pnpm version:set 0.3.0");
  process.exit(1);
}

const files = [
  ["package.json", /("version":\s*")[^"]+(")/],
  ["src-tauri/tauri.conf.json", /("version":\s*")[^"]+(")/],
  ["src-tauri/Cargo.toml", /^(version\s*=\s*")[^"]+(")/m],
];
for (const [path, re] of files) {
  const text = readFileSync(path, "utf8");
  if (!re.test(text)) throw new Error(`No version found in ${path}`);
  writeFileSync(path, text.replace(re, `$1${version}$2`));
  console.log(`${path} -> ${version}`);
}
console.log(`\nNext: cargo build (refreshes Cargo.lock), commit, then \`git tag v${version} && git push origin main v${version}\`.`);

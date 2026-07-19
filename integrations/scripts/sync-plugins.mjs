#!/usr/bin/env node
// Deploy the repo's canonical integration sources into the locally-installed
// plugin copies so the running Claude Code + Codex plugins match the repo.
// The install chain (repo -> marketplace -> cache) is otherwise manual and
// silently drifts; run this after changing anything under integrations/.
import { cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const home = homedir();
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const claudeSource = join(repoRoot, "integrations", "claude-code");
const codexSource = join(repoRoot, "integrations", "codex");
const subdirs = ["scripts", "skills", "hooks"];

function copyInto(source, destination) {
  if (!existsSync(destination)) return false;
  let copied = false;
  for (const sub of subdirs) {
    const from = join(source, sub);
    if (!existsSync(from)) continue;
    cpSync(from, join(destination, sub), { recursive: true });
    copied = true;
  }
  return copied;
}

function versionDirs(root) {
  if (!existsSync(root)) return [];
  const results = [];
  for (const pluginName of readdirSync(root)) {
    const pluginDir = join(root, pluginName);
    if (!statSync(pluginDir).isDirectory()) continue;
    for (const version of readdirSync(pluginDir)) {
      const versionDir = join(pluginDir, version);
      if (statSync(versionDir).isDirectory()) results.push(versionDir);
    }
  }
  return results;
}

const targets = [
  { label: "claude marketplace", source: claudeSource, dir: join(home, ".claude/plugins/marketplaces/relay-local") },
  ...versionDirs(join(home, ".claude/plugins/cache/relay-local")).map((dir) => ({ label: "claude cache", source: claudeSource, dir })),
  ...versionDirs(join(home, ".codex/plugins/cache/relay-local")).map((dir) => ({ label: "codex cache", source: codexSource, dir })),
];

let synced = 0;
for (const target of targets) {
  if (copyInto(target.source, target.dir)) {
    synced += 1;
    console.log(`synced ${target.label}: ${target.dir}`);
  }
}

if (synced === 0) {
  console.log("No installed plugin copies found to sync.");
} else {
  console.log(`\nDone. Synced ${synced} installed plugin location(s).`);
}

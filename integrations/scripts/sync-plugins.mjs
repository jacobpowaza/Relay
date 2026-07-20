#!/usr/bin/env node
// ---------------------------------------------------------------------------
// sync-plugins — deploy the repo's canonical plugin sources into locally-
// installed Claude Code and Codex plugin directories so running agents match
// the current integration code in the repository.
//
// WHAT IT DOES
//  1. Builds @relay/integration-core and vendors it into each plugin's core/
//  2. Deploys the FULL plugin tree (manifests, hooks, scripts, skills,
//     commands, MCP config, MCP server, package.json, vendored core) to:
//       - Claude Code marketplace  (~/.claude/plugins/marketplaces/relay-local)
//       - Claude Code cache        (~/.claude/plugins/cache/relay-progress/$version)
//       - Codex cache              (~/.codex/plugins/cache/relay/$version)
//  3. Validates that the deployed plugin can load its manifest
//
// SAFETY
//  - Hidden files (.claude-plugin, .codex-plugin, .mcp.json) ARE included
//    because we use cpSync with { recursive: true } on directories.
//  - .turbo build artifacts are excluded from deployment.
//  - Existing installations are fully replaced (rm then cp), not patched.
// ---------------------------------------------------------------------------
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const home = homedir();
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..");

const CLAUDE_SOURCE = join(repoRoot, "integrations", "claude-code");
const CODEX_SOURCE = join(repoRoot, "integrations", "codex");

// ------------------------------------------------------------------ helpers

/** List version subdirectories inside a plugin cache root, e.g. relay/0.1.0 */
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

/** Full recursive copy — includes hidden files/dirs because we copy
 *  individual directory trees rather than using a glob. */
function deploy(sourceDir, targetDir) {
  if (!existsSync(sourceDir)) {
    console.error(`  SKIP: source does not exist: ${sourceDir}`);
    return false;
  }
  mkdirSync(targetDir, { recursive: true });

  // Copy every entry in sourceDir into targetDir, replacing existing.
  // Exclude build artifacts that should never be deployed.
  const exclude = new Set([".turbo"]);
  for (const entry of readdirSync(sourceDir)) {
    if (exclude.has(entry)) continue;
    const src = join(sourceDir, entry);
    const dst = join(targetDir, entry);
    // rm old destination to avoid stale leftovers from prior deploys
    rmSync(dst, { recursive: true, force: true });
    cpSync(src, dst, { recursive: true });
  }
  return true;
}

/** Quick sanity — check that the deploy looks complete */
function validatePlugin(rootDir, required) {
  const missing = required.filter((file) => !existsSync(join(rootDir, file)));
  if (missing.length > 0) {
    console.error(`  WARNING: ${rootDir} is missing: ${missing.join(", ")}`);
    return false;
  }
  return true;
}

// -------------------------------------------------------- step 0: build core

console.log("=== sync-plugins ===\n");

console.log("[1/4] Building @relay/integration-core...");
try {
  execFileSync("pnpm", ["--filter", "@relay/integration-core", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    timeout: 60_000,
  });
} catch {
  console.error("ERROR: integration-core build failed. Aborting.");
  process.exit(1);
}

// -------------------------------------------------- step 1: vendor core into
// each plugin source tree (so the deployed copy is complete)

console.log("[2/4] Vendoring integration-core into plugins...");
for (const pluginDir of [CLAUDE_SOURCE, CODEX_SOURCE]) {
  const coreTarget = join(pluginDir, "core");
  rmSync(coreTarget, { recursive: true, force: true });
  mkdirSync(coreTarget, { recursive: true });
  cpSync(join(repoRoot, "integrations", "core", "dist", "src"), coreTarget, { recursive: true });
  console.log(`  vendored → ${relative(repoRoot, coreTarget)}`);
}

// ---------------------------------------------------------- step 2: deploy to
// marketplace + cache for Claude Code, cache for Codex

console.log("[3/4] Deploying plugins...");

const targets = [];

// Claude Code — marketplace (for first-time install / auto-discovery)
const claudeMarketplace = join(home, ".claude/plugins/marketplaces/relay-local");
targets.push({ label: "claude marketplace", source: CLAUDE_SOURCE, dir: claudeMarketplace });

// Claude Code — cache (every installed version dir)
for (const versionDir of versionDirs(join(home, ".claude/plugins/cache/relay-local"))) {
  targets.push({ label: "claude cache", source: CLAUDE_SOURCE, dir: versionDir });
}

// Codex — cache (every installed version dir)
for (const versionDir of versionDirs(join(home, ".codex/plugins/cache/relay-local"))) {
  targets.push({ label: "codex cache", source: CODEX_SOURCE, dir: versionDir });
}

let deployed = 0;
for (const target of targets) {
  const ok = deploy(target.source, target.dir);
  if (ok) {
    deployed += 1;
    console.log(`  deployed → ${target.label}: ${target.dir}`);
  } else {
    console.log(`  skipped  → ${target.label}: ${target.dir} (no source)`);
  }
}

// ----------------------------------------------------------- step 3: validate

console.log("[4/4] Validating deployments...");

const claudeRequired = [".claude-plugin/plugin.json", "hooks/session-start.mjs", "scripts/relay-progress.mjs", "skills/progress/SKILL.md", "core/index.js"];
const codexRequired = [".codex-plugin/plugin.json", ".mcp.json", "hooks.json", "hooks/session-start.mjs", "scripts/relay-progress.mjs", "mcp/relay-mcp.mjs", "commands/relay.md", "skills/progress/SKILL.md", "core/index.js"];

let validated = 0;
for (const target of targets) {
  const required = target.label.startsWith("codex") ? codexRequired : claudeRequired;
  if (validatePlugin(target.dir, required)) {
    validated += 1;
  }
}

// ------------------------------------------------ optional step 5: status line
// Only runs when --install-statusline is passed, since modifying
// ~/.claude/settings.json is a global side-effect.

if (process.argv.includes("--install-statusline")) {
  console.log("\n[5/5] Registering Relay status line (Claude Code)...");
  const installerPath = join(claudeMarketplace, "scripts", "install-statusline.mjs");
  if (existsSync(installerPath)) {
    try {
      execFileSync(process.execPath, [installerPath], {
        cwd: repoRoot,
        stdio: "inherit",
        timeout: 15_000,
      });
    } catch (e) {
      console.error(`  install-statusline.mjs failed (non-fatal): ${e.message}`);
    }
  } else {
    console.log("  SKIP: no deployment found for Claude Code marketplace.");
  }
}

console.log(`\nDone. ${deployed} deployed, ${validated} validated.`);

if (deployed === 0) {
  console.log("No installed plugin copies found. For first-time setup:");
  console.log(`  Claude Code: cp -R ${relative(repoRoot, CLAUDE_SOURCE)}/.  ${claudeMarketplace}`);
  console.log(`  Codex:       cp -R ${relative(repoRoot, CODEX_SOURCE)}/.  ~/.codex/plugins/cache/relay-local/relay/0.1.0/`);
}

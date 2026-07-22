#!/usr/bin/env node
// statusline.mjs — single-line Relay indicator.
//
// PLATFORM NOTE: Codex has no status line mechanism — there is no equivalent of
// Claude Code's `statusLine` setting, and no config.toml key for it. This is
// therefore an ON-DEMAND status command here, not a live indicator: run it
// directly, or via the /relay command. The continuously-updating behavior only
// exists on Claude Code. See integrations/README.md for the full divergence.
//
// Kept in step with the Claude Code copy apart from this note so the two
// platforms report the same thing.
//
// Reads ~/.relay/integrations/config.json and the Relay workspace to determine:
//   [RELAY] Disabled         — integration disabled in config
//   [RELAY] Inactive         — no linked board for this repo
//   [RELAY] Error            — linked board not found in workspace
//   [RELAY] Active           — linked, no active card
//   [RELAY] Active · Card    — linked, with active card title
//
// When a discovery index exists it appends file/feature/changed counts.
//
// Accepts --cwd <path> for testing (skips stdin).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalizeRepositoryPath } from "./canonical-path.mjs";
import { buildDiscoveryLine } from "../core/discovery.js";

const home = homedir();
const configPath = join(home, ".relay/integrations/config.json");
const workspacePath = join(home, "Library/Application Support/Relay/relay-data/workspace.json");

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return fallback; }
}

function readStdin() {
  return new Promise((resolveInput) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolveInput(data));
  });
}

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? undefined : process.argv[idx + 1];
}

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
  } catch { return undefined; }
}

function detectRepository(cwd) {
  const rawRoot = git(cwd, ["rev-parse", "--show-toplevel"]) ?? resolve(cwd);
  const canonical = (() => { try { return canonicalizeRepositoryPath(rawRoot); } catch { return undefined; } })();
  return { root: canonical?.path ?? resolve(rawRoot), rootKey: canonical?.key ?? resolve(rawRoot).toLowerCase() };
}

function findRepoLink(config, key) {
  for (const [path, link] of Object.entries(config.repositories ?? {})) {
    const p = (() => { try { return canonicalizeRepositoryPath(path); } catch { return undefined; } })();
    if (p?.key === key) return link;
  }
  return undefined;
}

function loadConfig() {
  return {
    enabled: true, localOnly: false, repositories: {},
    uploadSourceSnippets: false, storeRawTranscripts: false,
    automaticBoardCreation: "ask", checkpointFrequency: "meaningful_steps",
    ...readJson(configPath, {}),
  };
}

async function main() {
  // Determine working directory from stdin JSON, --cwd, or process.cwd()
  const stdinRaw = (await readStdin()).trim();
  let cwd = process.cwd();
  if (stdinRaw) {
    try {
      const parsed = JSON.parse(stdinRaw);
      cwd = parsed.cwd ?? parsed.workspace?.current_dir ?? cwd;
    } catch { /* stdin not JSON — ignore */ }
  }
  cwd = arg("--cwd") ?? cwd;

  const config = loadConfig();
  if (config.enabled === false) { console.log("[RELAY] Disabled"); return; }

  const repo = detectRepository(cwd);
  const link = findRepoLink(config, repo.rootKey);
  if (!link?.enabled) { console.log("[RELAY] Inactive"); return; }

  // Load workspace just enough to find the board and active card
  const workspace = readJson(workspacePath, { boards: [] });
  const board = (workspace.boards ?? []).find((b) => b.id === link.boardId);
  if (!board) { console.log("[RELAY] Error"); return; }

  // Blocked cards are excluded from BOTH selectors, matching selectActiveCard
  // in the session-start hooks. Excluding them only from the fallback let a
  // blocked card sit in the status line as the current work indefinitely.
  const open = (board.cards ?? []).filter((c) => c.archivedAt === undefined && !c.blocked);
  const card = open.find((c) => c.columnId === "progress") ?? open.find((c) => c.columnId !== "verified");

  const segments = ["[RELAY] Active"];
  if (card) segments.push(card.title?.slice(0, 36).trim() ?? "");

  const discovery = workspace.discoveries?.[repo.rootKey]
    ?? workspace.discoveries?.[repo.root]
    ?? board.discovery;
  if (discovery) {
    // Counts only. buildDiscoveryLine leads with the repo name, which the
    // shell already shows, so drop that first segment.
    const line = buildDiscoveryLine(repo.root, discovery).split(" · ").slice(1).join(" · ");
    if (line) segments.push(line);
  }

  console.log(segments.join(" · "));
}

main().catch(() => { console.log("[RELAY] Error"); });

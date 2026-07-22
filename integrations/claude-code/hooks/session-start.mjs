#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { buildDiscoveryContextPacket } from "../core/discovery.js";

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1500 }).trim();
  } catch {
    return undefined;
  }
}

function detectRepository(cwd) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]) ?? resolve(cwd);
  const status = (git(root, ["status", "--porcelain=v1"]) ?? "").split(/\r?\n/).filter(Boolean);
  return {
    root,
    workingDirectory: resolve(cwd),
    remoteUrl: git(root, ["config", "--get", "remote.origin.url"]),
    branch: git(root, ["branch", "--show-current"]),
    headCommit: git(root, ["rev-parse", "HEAD"]),
    dirty: status.length > 0,
    changedFiles: status.map((line) => line.slice(3).trim()).slice(0, 20)
  };
}

function loadConfig() {
  const path = `${homedir()}/.relay/integrations/config.json`;
  if (!existsSync(path)) return { enabled: true, repositories: {} };
  try {
    return { enabled: true, repositories: {}, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { enabled: true, repositories: {} };
  }
}

function loadWorkspace() {
  const path = `${homedir()}/Library/Application Support/Relay/relay-data/workspace.json`;
  if (!existsSync(path)) return { boards: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { boards: [] };
  }
}

// A blocked card is NOT active work. Excluding it only from the fallback let a
// card parked in the In Progress column shadow every other card indefinitely,
// and it was fed to the session as both "Active card" and the discovery task
// hint, pulling in summaries for whatever the blocked card happened to touch.
function selectActiveCard(board) {
  const open = (board?.cards ?? []).filter((card) => card.archivedAt === undefined && !card.blocked);
  return open.find((card) => card.columnId === "progress")
    ?? open.find((card) => card.columnId !== "verified");
}

function boardSummary(board, activeCard) {
  if (board === undefined) return undefined;
  const context = (board.context ?? []).slice(0, 5).map((item) => `${item.category}: ${item.title} - ${item.content}`).join("\n");
  const activity = (board.activity ?? []).slice(0, 4).map((item) => `${item.actor} ${item.action} ${item.target}`).join("; ");
  return [
    `Board: ${board.name}; phase ${board.currentPhase}; active tasks ${board.activeTasks}; blockers ${board.blockers}.`,
    activeCard === undefined ? "Active card: none selected." : `Active card: ${activeCard.title}; status ${activeCard.columnId}; priority ${activeCard.priority}; progress ${activeCard.progress}%.`,
    context === "" ? "Context: none recorded." : `Context:\n${context}`,
    activity === "" ? "Recent activity: none." : `Recent activity: ${activity}`,
  ].join("\n");
}

// Discovery context is built by integrations/core (vendored into ./core) so the
// two platforms cannot drift. Everything below is delegation, not logic.
function buildDiscoveryContext(repoRoot, workspace, taskHint) {
  const discovery = loadWorkspaceDiscoveryFrom(workspace, repoRoot);
  if (!discovery?.entries?.length) return undefined;
  return buildDiscoveryContextPacket(discovery, { repoRoot, taskHint });
}

// The core loader reads workspace.json from disk; the hook already holds the
// parsed object, so key normalization is mirrored here rather than re-reading.
// Must match discoveryKey() in the desktop main process.
function loadWorkspaceDiscoveryFrom(workspace, repoRoot) {
  const key = repoRoot.replace(/\/+$/, "").toLowerCase();
  return workspace.discoveries?.[key]
    ?? workspace.discoveries?.[repoRoot]
    ?? workspace.boards?.find((b) => b.repository === repoRoot)?.discovery;
}

const input = await new Promise((resolveInput) => {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { data += chunk; });
  process.stdin.on("end", () => resolveInput(data));
});

let cwd = process.cwd();
try {
  const parsed = JSON.parse(input || "{}");
  cwd = parsed.cwd ?? parsed.workspace?.current_dir ?? cwd;
} catch {}

const repository = detectRepository(cwd);
const config = loadConfig();
const link = config.repositories?.[repository.root];
const workspace = loadWorkspace();
const board = workspace.boards?.find((candidate) => candidate.id === link?.boardId || candidate.repository === repository.root);

if (config.enabled === false) process.exit(0);
if (link?.enabled !== true) {
  console.log([
    "[RELAY] Inactive",
    `Repo ${repository.root} is not linked to a Relay board.`,
    "For long tasks, create/link a Relay board before durable tracking. Do not create repository scratch-board files as substitutes.",
  ].join("\n"));
  process.exit(0);
}

const activeCard = selectActiveCard(board);

const lines = [
  board === undefined ? "[RELAY] Error" : "[RELAY] Active",
  `Board ${link.boardId} is persistent source of truth for long-running work.`,
  `Repo ${repository.root}; branch ${repository.branch ?? "unknown"}; dirty ${repository.dirty ? "yes" : "no"}.`,
  boardSummary(board, activeCard) ?? "Linked board was not found in app-owned storage; run Relay status before continuing.",
  "Resume behavior: continue the active card first; if none is active, choose the first unverified, unblocked card. Read only relevant context above unless the user asks for a broader audit.",
  "Checkpoint meaningful progress before card switch, compaction, or session end. Do not upload secrets.",
];

// The active card is the best statement of intent available at session start,
// so it drives the relevance filter. Without it the packet falls back to counts
// only, which is the whole-index behavior we are trying to avoid.
const taskHint = [activeCard?.title, activeCard?.tags?.join(" ")].filter(Boolean).join(" ");
const discoveryContext = buildDiscoveryContext(repository.root, workspace, taskHint);
if (discoveryContext !== undefined) lines.push(discoveryContext);

console.log(lines.join("\n"));

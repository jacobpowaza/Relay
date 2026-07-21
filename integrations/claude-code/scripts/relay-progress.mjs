#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { canonicalizeRepositoryPath } from "./canonical-path.mjs";

const home = homedir();
const relayDataPath = join(home, "Library/Application Support/Relay/relay-data/workspace.json");
const configPath = join(home, ".relay/integrations/config.json");
const pendingDir = join(home, ".relay/integrations/pending");
const defaultColumns = [
  { id: "backlog", name: "Backlog", tone: "gray" },
  { id: "ready", name: "Ready", tone: "violet" },
  { id: "progress", name: "In Progress", tone: "blue" },
  { id: "review", name: "Needs Review", tone: "orange" },
  { id: "verified", name: "Verified", tone: "green" },
];
const tagTones = ["blue", "green", "orange", "violet", "coral", "gray"];
const agentName = process.env.RELAY_AGENT_NAME ?? (process.argv[1]?.includes("claude") ? "Claude" : "Codex");
const agentKind = agentName.toLowerCase().includes("claude") ? "claude" : "codex";
const phaseNames = ["Foundation", "Updates", "macOS", "Windows", "Performance", "Testing", "Documentation", "Packaging", "Debugging", "Release"];
const MAX_RESUME_TOKENS = 3_000;
const MAX_CONTEXT_ENTRIES = 30;

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }).trim();
  } catch {
    return undefined;
  }
}

/** Canonicalize, never throwing. */
function canonicalSafe(path) {
  try {
    return canonicalizeRepositoryPath(path);
  } catch {
    return undefined;
  }
}

/** True when two paths resolve to the same canonical repository identity. */
function sameRepositoryPath(left, right) {
  const a = canonicalSafe(left);
  const b = canonicalSafe(right);
  return a !== undefined && b !== undefined && a.key === b.key;
}

function detectRepository(cwd = process.cwd()) {
  const workingDirectory = canonicalSafe(cwd)?.path ?? resolve(cwd);
  const rawRoot = git(workingDirectory, ["rev-parse", "--show-toplevel"]) ?? workingDirectory;
  const canonical = canonicalSafe(rawRoot) ?? { path: resolve(rawRoot), key: resolve(rawRoot) };
  const root = canonical.path;
  const status = (git(root, ["status", "--porcelain=v1"]) ?? "").split(/\r?\n/).filter(Boolean);
  return {
    root,
    rootKey: canonical.key,
    workingDirectory,
    remoteUrl: git(root, ["config", "--get", "remote.origin.url"]),
    branch: git(root, ["branch", "--show-current"]),
    headCommit: git(root, ["rev-parse", "HEAD"]),
    dirty: status.length > 0,
    changedFiles: status.map((line) => line.slice(3).trim()),
  };
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

function loadWorkspace() {
  return readJson(relayDataPath, {
    directories: [],
    boards: [],
    tags: [],
    settings: {
      displayName: "Local User",
      defaultView: "board",
      density: "comfortable",
      performanceMode: false,
      reduceMotion: false,
      compactCards: false,
      showStoragePath: true,
      activityLimit: 4,
      boardColumnWidth: 220,
    },
  });
}

function normalizeWorkspace(workspace) {
  workspace.directories ??= [];
  workspace.boards ??= [];
  workspace.tags ??= [];
  for (const board of workspace.boards) {
    board.columns ??= defaultColumns;
    board.cards ??= [];
    board.phases ??= [];
    board.context ??= [];
    board.decisions ??= [];
    board.activity ??= [];
    for (const card of board.cards) addSharedTags(workspace, card.tags ?? []);
  }
  return workspace;
}

/**
 * Merge duplicate directories that point at the same canonical repository and
 * drop duplicate boards that share an idempotency key. This enforces the "same
 * operation cannot accidentally create conflicting records" constraint on the
 * write path, since the plugin writes the workspace file directly.
 */
function reconcileWorkspace(workspace) {
  const directoryByKey = new Map();
  const remap = new Map();
  for (const directory of workspace.directories) {
    const canonical = directory.path === undefined ? undefined : canonicalSafe(directory.path);
    if (canonical === undefined) continue;
    const kept = directoryByKey.get(canonical.key);
    if (kept === undefined) {
      directory.path = canonical.path;
      directoryByKey.set(canonical.key, directory);
    } else {
      remap.set(directory.id, kept.id);
    }
  }
  if (remap.size > 0) {
    workspace.directories = workspace.directories.filter((directory) => !remap.has(directory.id));
    for (const board of workspace.boards) {
      if (remap.has(board.directoryId)) board.directoryId = remap.get(board.directoryId);
    }
  }

  const seenKeys = new Set();
  workspace.boards = workspace.boards.filter((board) => {
    if (typeof board.idempotencyKey !== "string" || board.idempotencyKey === "") return true;
    if (seenKeys.has(board.idempotencyKey)) return false;
    seenKeys.add(board.idempotencyKey);
    return true;
  });
  return workspace;
}

function saveWorkspace(workspace) {
  writeAtomic(relayDataPath, normalizeWorkspace(workspace));
}

function loadConfig() {
  return {
    enabled: true,
    localOnly: false,
    repositories: {},
    uploadSourceSnippets: false,
    storeRawTranscripts: false,
    automaticBoardCreation: "ask",
    checkpointFrequency: "meaningful_steps",
    ...readJson(configPath, {}),
  };
}

/** Find the config repository link for a repo by canonical identity, not raw string. */
function findRepoLink(config, repository) {
  const repositories = config.repositories ?? {};
  for (const [path, link] of Object.entries(repositories)) {
    if (canonicalSafe(path)?.key === repository.rootKey) return { path, link };
  }
  return undefined;
}

async function readStdin() {
  return new Promise((resolveInput) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolveInput(data));
  });
}

async function readPayload() {
  const input = (await readStdin()).trim();
  if (input === "") return {};
  try {
    return JSON.parse(input);
  } catch {
    return { body: input, text: input };
  }
}

function cleanTag(value) {
  return String(value ?? "").trim().replace(/^#/, "").replace(/\s+/g, "-").slice(0, 32);
}

function toneForTag(name) {
  let hash = 0;
  for (const character of name.toLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return tagTones[hash % tagTones.length] ?? "gray";
}

function addSharedTags(workspace, tags) {
  workspace.tags ??= [];
  for (const rawTag of tags) {
    const name = cleanTag(rawTag);
    if (name !== "" && !workspace.tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
      workspace.tags.push({ name, tone: toneForTag(name) });
    }
  }
}

function parseTags(value) {
  if (Array.isArray(value)) return value.map(cleanTag).filter(Boolean);
  if (typeof value === "string") return value.split(",").map(cleanTag).filter(Boolean);
  const cliTags = arg("--tags");
  return cliTags === undefined ? [] : cliTags.split(",").map(cleanTag).filter(Boolean);
}

function activity(action, target, now, tone = "blue") {
  return { id: randomUUID(), actor: agentName, actorKind: agentKind, action, target, time: now, tone };
}

function findLinkedBoard(workspace, repository, config, explicitBoardId = arg("--board-id")) {
  if (explicitBoardId !== undefined) return workspace.boards?.find((candidate) => candidate.id === explicitBoardId);
  const link = findRepoLink(config, repository)?.link;
  if (link?.boardId !== undefined) {
    const linked = workspace.boards?.find((candidate) => candidate.id === link.boardId);
    if (linked !== undefined) return linked;
  }
  const explicitTaskId = arg("--task-id");
  if (explicitTaskId !== undefined) return workspace.boards?.find((candidate) => candidate.taskId === explicitTaskId);
  return undefined;
}

function findPhase(board, requestedPhase) {
  if (requestedPhase === undefined) return board.phases?.[0];
  const normalized = requestedPhase.trim().toLowerCase();
  return board.phases?.find((phase) => phase.id === requestedPhase || phase.name.trim().toLowerCase() === normalized);
}

function findColumn(board, requestedColumn) {
  if (requestedColumn === undefined) return board.columns?.find((column) => column.id === "ready") ?? board.columns?.[0];
  return board.columns?.find((column) => column.id === requestedColumn || column.name.toLowerCase() === requestedColumn.toLowerCase());
}

function activeCard(board, explicitCardId = arg("--card-id")) {
  if (explicitCardId !== undefined) return board.cards?.find((card) => card.id === explicitCardId);
  return board.cards?.find((card) => card.columnId === "progress")
    ?? board.cards?.find((card) => card.columnId !== "verified" && !card.blocked)
    ?? board.cards?.[0];
}

function estimateComplexity(request) {
  const lines = request.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
  const sections = (request.match(/^#{2,3}\s+.+$/gm) ?? []).length;
  const listItems = (request.match(/^\s*[-*\d+.]\s+/gm) ?? []).length;
  const score = sections + Math.min(listItems, sections * 3) + Math.floor(lines / 5);
  if (score <= 3) return "small";
  if (score <= 8) return "medium";
  return "large";
}

function cardCountForComplexity(complexity) {
  if (complexity === "small") return 2;
  if (complexity === "medium") return 6;
  return 14;
}

function extractWorkAreas(request) {
  const headings = [...request.matchAll(/^#{2,3}\s+\d*\.?\s*(.+?)(?:\s+\[[^\]]+\])?\s*$/gm)]
    .map((m) => m[1]?.trim())
    .filter((t) => t !== undefined && t.length > 0);
  const numbered = [...request.matchAll(/^\d+\.\s+(.+)$/gm)]
    .map((m) => m[1]?.trim())
    .filter((t) => t !== undefined && t.length > 0);
  return headings.length >= 2 ? headings : numbered.length >= 2 ? numbered : [];
}

function smartTags(title, description) {
  const combined = `${title} ${description}`.toLowerCase();
  const found = [];
  if (/\b(api|endpoint|route|server|http)\b/.test(combined)) found.push("api");
  if (/\b(ui|component|render|react|view|page|screen)\b/.test(combined)) found.push("ui");
  if (/\b(test|spec|assert|vitest|jest)\b/.test(combined)) found.push("testing");
  if (/\b(doc|readme|guide|manual|help)\b/.test(combined)) found.push("documentation");
  if (/\b(security|auth|permission|rbac|oauth|token)\b/.test(combined)) found.push("security");
  if (/\b(perf|optimize|fast|cache|memory|cpu|latency)\b/.test(combined)) found.push("performance");
  if (/\b(database|db|sql|schema|migration|drizzle|postgres)\b/.test(combined)) found.push("database");
  if (/\b(update|version|release|electron-updater|upgrade)\b/.test(combined)) found.push("updates");
  if (/\b(mac|darwin|macos)\b/.test(combined)) found.push("macOS");
  if (/\b(win|windows)\b/.test(combined)) found.push("windows");
  if (/\b(tray|background|daemon|service|idle)\b/.test(combined)) found.push("lifecycle");
  if (/\b(cross.?platform|portable|multi.?platform)\b/.test(combined)) found.push("cross-platform");
  if (/\b(diag|instrument|log|monitor|telemetry)\b/.test(combined)) found.push("diagnostics");
  if (/\b(packag|build|electron-builder|sign|notarize|codesign)\b/.test(combined)) found.push("packaging");
  return found.length > 0 ? found : ["task"];
}

function cardTypeFor(title) {
  const combined = title.toLowerCase();
  if (/\b(security|rbac|auth|permission|oauth|token|audit)\b/.test(combined)) return "security";
  if (/\b(test|spec|assert)\b/.test(combined)) return "test";
  if (/\b(bug|fix|error|crash|broken|regression)\b/.test(combined)) return "bug";
  if (/\b(ui|component|render|react|view|page|screen)\b/.test(combined)) return "feature";
  if (/\b(doc|readme|guide|manual)\b/.test(combined)) return "task";
  if (/\b(research|investigate|explore|design)\b/.test(combined)) return "research";
  if (/\b(decision|choose|adopt)\b/.test(combined)) return "decision";
  return "task";
}

function deriveCards(request, phaseIds, now) {
  const workAreas = extractWorkAreas(request);
  const complexity = estimateComplexity(request);
  const targetCount = cardCountForComplexity(complexity);
  const totalPhases = phaseIds.length;

  if (workAreas.length >= 2 && workAreas.length <= targetCount) {
    return workAreas.map((area, index) => {
      const phaseIndex = Math.min(index, totalPhases - 1);
      return {
        id: randomUUID(),
        title: area,
        description: `Implement ${area.toLowerCase()}. Acceptance: working implementation verified by tests, no regressions, follows project conventions.`,
        columnId: index === 0 ? "progress" : "ready",
        phaseId: phaseIds[phaseIndex],
        type: cardTypeFor(area),
        priority: index === 0 ? "high" : "normal",
        tags: [...new Set(["agent-created", ...smartTags(area, request)])],
        notes: [],
        progress: index === 0 ? 1 : 0,
        criteriaDone: 0,
        criteriaTotal: Math.max(1, Math.min(5, 1 + Math.floor((targetCount - workAreas.length + index) / 3))),
        blocked: false,
        owner: "Agent",
        updatedAt: now,
        dependencies: index > 0 ? [workAreas[0]] : [],
      };
    });
  }

  // Only emit cards for work areas actually named in the request. Padding out
  // to targetCount invented cards titled "3. Implementation step 3", which
  // occupied columns, were reported as the active card by session-start, and
  // could never be removed. A board with no cards is honest; a board with
  // fabricated cards looks tracked and is not.
  return workAreas.slice(0, Math.min(targetCount, 20)).map((area, index) => {
    const phaseIndex = Math.min(index, totalPhases - 1);
    return {
      id: randomUUID(),
      title: area,
      description: `Implement ${area.toLowerCase()} with tests and documentation.`,
      columnId: index === 0 ? "progress" : "ready",
      phaseId: phaseIds[phaseIndex],
      type: cardTypeFor(area),
      priority: index === 0 ? "high" : "normal",
      // Tagged so prunePlaceholders can retire them once the agent has
      // replaced them with cards carrying real reasoning.
      tags: [...new Set(["agent-created", "placeholder", ...smartTags(area, request)])],
      notes: [],
      progress: index === 0 ? 1 : 0,
      criteriaDone: 0,
      criteriaTotal: 2,
      blocked: false,
      owner: "Agent",
      updatedAt: now,
      dependencies: index > 0 && workAreas.length > 1 ? [workAreas[0]] : [],
    };
  });
}

/** A seeded card is disposable until someone has actually worked it. */
function isUntouchedPlaceholder(card) {
  return (card.tags ?? []).includes("placeholder")
    && (card.notes ?? []).length === 0
    && (card.progress ?? 0) <= 1
    && card.columnId !== "verified"
    && card.blocked !== true;
}

/**
 * Drops seeded placeholders once real cards exist on the board. Called
 * automatically after create-card so the board self-cleans as soon as the
 * agent records its first genuine task.
 * @returns {string[]} titles of removed cards
 */
function prunePlaceholders(board) {
  const real = board.cards.filter((card) => !(card.tags ?? []).includes("placeholder"));
  if (real.length === 0) return [];
  const doomed = board.cards.filter(isUntouchedPlaceholder);
  if (doomed.length === 0) return [];
  const doomedIds = new Set(doomed.map((card) => card.id));
  board.cards = board.cards.filter((card) => !doomedIds.has(card.id));
  return doomed.map((card) => card.title);
}

function requestHighlights(request) {
  const lines = request
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter((line) => line.length > 0 && line.length < 220);
  return lines.slice(0, 6);
}

function deriveContext(request, repository, now, taskId) {
  const highlights = requestHighlights(request);
  return [
    {
      id: randomUUID(),
      category: "Current state",
      title: "Repository identity",
      content: [
        `Root: ${repository.root}`,
        `Branch: ${repository.branch ?? "unknown"}`,
        `HEAD: ${repository.headCommit ?? "unknown"}`,
        `Dirty worktree: ${repository.dirty ? "yes" : "no"}`,
        repository.changedFiles.length === 0 ? "Changed files: none" : `Changed files: ${repository.changedFiles.slice(0, 12).join(", ")}`,
      ].join("\n"),
      confidence: "High",
      updatedAt: now,
    },
    {
      id: randomUUID(),
      category: "Important file",
      title: "Repository root",
      content: `Plugin linked this Relay board to ${repository.root}. Use that path as the source of truth for implementation state.`,
      confidence: "High",
      updatedAt: now,
    },
    ...(highlights.length === 0 ? [] : [{
      id: randomUUID(),
      category: "Current state",
      title: "Original request highlights",
      content: highlights.map((line) => `- ${line}`).join("\n"),
      confidence: "Medium",
      updatedAt: now,
    }]),
    {
      id: randomUUID(),
      category: "Current state",
      title: "Task identity",
      content: `taskId=${taskId}. Full original prompt and plan stored in board.plan. Reference by ID; do not copy full text into context.`,
      confidence: "High",
      updatedAt: now,
    },
  ];
}

function summarizeBoard(board) {
  if (board === undefined) return undefined;
  const activeCard = board.cards?.find((card) => card.archivedAt === undefined && card.columnId === "progress")
    ?? board.cards?.find((card) => card.archivedAt === undefined && card.columnId !== "verified" && !card.blocked)
    ?? board.cards?.[0];
  return {
    id: board.id,
    name: board.name,
    repository: board.repository,
    currentPhase: board.currentPhase,
    activeTasks: board.activeTasks,
    blockers: board.blockers,
    activeCard: activeCard === undefined ? null : {
      id: activeCard.id,
      title: activeCard.title,
      status: activeCard.columnId,
      priority: activeCard.priority,
      owner: activeCard.owner,
      progress: activeCard.progress,
      description: activeCard.description,
      tags: activeCard.tags ?? [],
    },
    context: (board.context ?? []).slice(0, 8).map((item) => ({
      category: item.category,
      title: item.title,
      content: item.content,
      confidence: item.confidence,
      updatedAt: item.updatedAt,
    })),
    recentActivity: (board.activity ?? []).slice(0, 6).map((item) => ({
      actor: item.actor,
      action: item.action,
      target: item.target,
      time: item.time,
    })),
  };
}

async function status() {
  const repository = detectRepository(arg("--cwd") ?? process.cwd());
  const config = loadConfig();
  const link = findRepoLink(config, repository)?.link;
  const workspace = normalizeWorkspace(loadWorkspace());
  const board = findLinkedBoard(workspace, repository, config);
  console.log(JSON.stringify({
    indicator: config.enabled === false ? "[RELAY] Disabled" : link?.enabled === true ? board === undefined ? "[RELAY] Error" : "[RELAY] Active" : "[RELAY] Inactive",
    repository,
    relayDataPath,
    configPath,
    enabled: config.enabled !== false,
    linked: link?.enabled === true,
    boardId: link?.boardId,
    board: summarizeBoard(board),
  }, null, 2));
}

function buildResumeOutput(board, repository, budget = MAX_RESUME_TOKENS) {
  const activeCard = board.cards?.find((card) => card.archivedAt === undefined && card.columnId === "progress")
    ?? board.cards?.find((card) => card.archivedAt === undefined && card.columnId !== "verified" && !card.blocked);

  const parts = [];
  parts.push("[RELAY] Active");
  parts.push(`Board: ${board.name} (${board.id.slice(0, 8)}...) | Phase: ${board.currentPhase} | Active: ${board.activeTasks} | Blockers: ${board.blockers}`);
  parts.push(`Repo: ${repository.root} branch=${repository.branch ?? "?"} dirty=${repository.dirty ? "yes" : "no"}`);

  if (activeCard !== undefined) {
    parts.push("");
    parts.push(`Active card: ${activeCard.title}`);
    parts.push(`  Status: ${activeCard.columnId} | Priority: ${activeCard.priority} | Progress: ${activeCard.progress}%`);
    parts.push(`  Owner: ${activeCard.owner}`);
    const tags = (activeCard.tags ?? []).filter(Boolean);
    if (tags.length > 0) parts.push(`  Tags: ${tags.join(", ")}`);
  } else {
    parts.push("");
    parts.push("No active card. Start first unblocked card in Ready column.");
  }

  // Deduplicate context by content hash before rendering
  const seenHashes = new Set();
  const dedupedContext = (board.context ?? []).filter((item) => {
    if (item.content === undefined) return true;
    const hash = contentHash(item.content);
    if (seenHashes.has(hash)) return false;
    seenHashes.add(hash);
    return true;
  });

  const recentContext = dedupedContext.slice(0, 3);
  if (recentContext.length > 0) {
    parts.push("");
    for (const item of recentContext) {
      const snippet = typeof item.content === "string" ? item.content.slice(0, 200).replace(/\n/g, " ") : "";
      parts.push(`- ${item.category}: ${item.title.slice(0, 60)} — ${snippet}`);
    }
  }

  const blockers = (board.cards ?? []).filter((card) => card.blocked);
  if (blockers.length > 0) {
    parts.push("");
    parts.push(`Blockers (${blockers.length}):`);
    for (const card of blockers) parts.push(`  - ${card.title}`);
  }

  const decisions = (board.decisions ?? []).slice(0, 2);
  if (decisions.length > 0) {
    parts.push("");
    parts.push("Recent decisions:");
    for (const d of decisions) parts.push(`  - ${d.title}: ${d.decision.slice(0, 120).replace(/\n/g, " ")}`);
  }

  parts.push("");
  parts.push("Instruction: Continue active card. Checkpoint meaningful progress. Record decisions and blockers.");
  parts.push("Full board context: relay-progress.mjs status --cwd <path>");

  let output = parts.join("\n");
  // Truncate to budget if over
  if (estimateTokens(output) > budget) {
    const lines = output.split("\n");
    let trimmed = lines.slice(0, 2).join("\n");
    for (let i = 2; i < lines.length; i++) {
      const next = trimmed + "\n" + lines[i];
      if (estimateTokens(next) > budget) {
        const remaining = lines.length - i;
        trimmed += `\n... (${remaining} more lines truncated for token budget)`;
        break;
      }
      trimmed = next;
    }
    output = trimmed;
  }
  return output;
}

async function resume() {
  const repository = detectRepository(arg("--cwd") ?? process.cwd());
  const config = loadConfig();
  if (config.enabled === false) {
    console.log("[RELAY] Disabled\nRelay is disabled. Do not inject Relay instructions or board context.");
    return;
  }
  const workspace = normalizeWorkspace(loadWorkspace());
  const board = findLinkedBoard(workspace, repository, config);
  if (board === undefined) {
    console.log([
      "[RELAY] Inactive",
      `Repo ${repository.root} is not linked to a Relay board.`,
      "Create or link a board before relying on Relay resume behavior.",
    ].join("\n"));
    return;
  }
  console.log(buildResumeOutput(board, repository));
}

/** Rough token estimate: ~4 chars per token for English text. */
function estimateTokens(text) {
  if (typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Detect if a request is a continuation of existing work rather than a new task.
 * Continuation signals: explicit keywords, short/statement phrasing, no plan sections.
 */
function isContinuation(request) {
  if (typeof request !== "string" || request.trim() === "") return false;
  const lower = request.toLowerCase();
  const hasKeyword = /\b(continue|resume|keep\s*working|next\s*step|follow\s*up|finish|complete|remaining|onward|keep\s+going|go\s+ahead|proceed)\b/i.test(lower);
  if (hasKeyword) return true;
  // Structured plans with headings or numbered steps are new tasks.
  const hasHeading = (request.match(/^#{2,3}\s+.+$/gm) ?? []).length >= 1;
  const hasNumbered = (request.match(/^\d+\.\s+.+$/gm) ?? []).length >= 3;
  if (hasHeading || hasNumbered) return false;
  // Short unstructured statements may be continuations.
  const lines = request.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.length <= 3 && lines.every((l) => l.length < 120);
}

/** Normalised content hash for dedup. */
function contentHash(text) {
  return createHash("sha1").update(text.trim().replace(/\s+/g, " ").toLowerCase()).digest("hex").slice(0, 16);
}

/**
 * Derive a stable task identity from the repository key and request content.
 * Different requests produce different taskIds for deterministic dedup.
 * Follow-up prompts with different wording are handled by auto-continuation
 * (config link + isContinuation detection) or explicit --task-id.
 */
function deriveTaskId(repositoryKey, request) {
  return createHash("sha1").update(`task:${repositoryKey}\n${request}`).digest("hex").slice(0, 16);
}

function deriveIdempotencyKey(repositoryKey, taskId, title) {
  return createHash("sha1").update(`board:${repositoryKey}\n${taskId}\n${title}`).digest("hex").slice(0, 16);
}

function pendingPath(idempotencyKey) {
  return join(pendingDir, `${idempotencyKey}.json`);
}

/** Re-read the workspace file from disk and return the persisted board, if any. */
function readbackBoard(boardId) {
  const disk = readJson(relayDataPath, undefined);
  if (disk === undefined || !Array.isArray(disk.boards)) return undefined;
  return disk.boards.find((board) => board.id === boardId);
}

/**
 * Persist a structured failure so the operation can be retried and the user can
 * see what went wrong: preserve the plan + diagnostics under
 * ~/.relay/integrations/pending, add a failed activity entry to any existing
 * linked board, print the failure to stderr, and exit non-zero.
 */
function recordFailure(stage, error, diagnostics, plan) {
  const at = new Date().toISOString();
  const failure = {
    ok: false,
    stage,
    error: error instanceof Error ? error.message : String(error),
    diagnostics: { ...diagnostics, stage },
    at,
  };
  try {
    if (typeof diagnostics.idempotencyKey === "string") {
      writeAtomic(pendingPath(diagnostics.idempotencyKey), { ...failure, plan: plan ?? "" });
    }
  } catch {
    // best effort; never mask the original failure
  }
  try {
    const workspace = normalizeWorkspace(loadWorkspace());
    const board = workspace.boards.find((candidate) => candidate.id === diagnostics.attemptedBoardId)
      ?? workspace.boards.find((candidate) => sameRepositoryPath(candidate.repository ?? "", diagnostics.repositoryPath ?? ""));
    if (board !== undefined) {
      board.activity.unshift(activity("failed to create board", diagnostics.requestedTitle ?? board.name, at, "orange"));
      board.context.unshift({
        id: randomUUID(),
        category: "Warning",
        title: `Board creation failed (${stage})`,
        content: `${failure.error}\nRepository: ${diagnostics.repositoryPath}\nAttempted board: ${diagnostics.attemptedBoardId ?? "n/a"}\nIdempotency key: ${diagnostics.idempotencyKey}`,
        confidence: "High",
        updatedAt: at,
      });
      board.lastActivity = at;
      saveWorkspace(workspace);
    }
  } catch {
    // best effort; do not throw from the failure handler
  }
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}

/**
 * Create a Relay board as one verified transaction.
 *
 * Modes:
 *   default              -> create a NEW board for this task (idempotent by a
 *                           stable key so repeated calls for the same task
 *                           resume rather than duplicate).
 *   --continue           -> attach to the existing board named like --title.
 *   --continue-board <n> -> attach to the existing board named <n>.
 *   --board-id <id>      -> attach to a specific existing board.
 *   --idempotency-key <k>-> override the derived idempotency key.
 */
async function createBoard() {
  const repository = detectRepository(arg("--cwd") ?? process.cwd());
  const title = arg("--title") ?? repository.root.split("/").at(-1) ?? "Relay Board";
  const request = (await readStdin()).trim();
  const now = new Date().toISOString();

  const explicitBoardId = arg("--board-id");
  const explicitTaskId = arg("--task-id");
  const continueName = arg("--continue-board") ?? (hasFlag("--continue") ? title : undefined);
  const taskId = deriveTaskId(repository.rootKey, request || title);
  const idempotencyKey = arg("--idempotency-key") ?? deriveIdempotencyKey(repository.rootKey, taskId, title);

  const diagnostics = {
    workspacePath: relayDataPath,
    configPath,
    repositoryPath: repository.root,
    repositoryWorkingDirectory: repository.workingDirectory,
    requestedTitle: title,
    attemptedBoardId: explicitBoardId,
    taskId,
    idempotencyKey,
    stage: "resolve",
  };

  try {
    const config = loadConfig();
    const workspace = reconcileWorkspace(normalizeWorkspace(loadWorkspace()));

    let directory = workspace.directories.find((item) => item.path !== undefined && sameRepositoryPath(item.path, repository.root));
    if (directory === undefined) {
      directory = { id: randomUUID(), name: title, path: repository.root };
      workspace.directories.push(directory);
    } else if (directory.path === undefined) {
      directory.path = repository.root;
    }

    let existing;
    let mode;
    if (explicitTaskId !== undefined) {
      existing = workspace.boards.find((board) => board.taskId === explicitTaskId);
      if (existing === undefined) throw new Error(`No Relay board with taskId ${explicitTaskId} to continue.`);
      mode = "continue";
    } else if (explicitBoardId !== undefined) {
      existing = workspace.boards.find((board) => board.id === explicitBoardId);
      if (existing === undefined) throw new Error(`No Relay board with id ${explicitBoardId} to continue.`);
      mode = "continue";
    } else if (continueName !== undefined) {
      const wanted = continueName.toLowerCase();
      existing = workspace.boards.find((board) => board.taskId === taskId)
        ?? workspace.boards.find((board) => (board.name ?? "").toLowerCase() === wanted && sameRepositoryPath(board.repository ?? "", repository.root));
      if (existing === undefined) throw new Error(`No Relay board named "${continueName}" to continue in ${repository.root}.`);
      mode = "continue";
    } else {
      // Auto-continuation: config-linked board + continuation-like request
      const link = findRepoLink(config, repository)?.link;
      if (link?.boardId !== undefined && isContinuation(request)) {
        existing = workspace.boards.find((board) => board.id === link.boardId);
        if (existing !== undefined) mode = "resumed";
      }
      // Fall through to exact taskId/idempotencyKey match
      if (existing === undefined) {
        existing = workspace.boards.find((board) => board.taskId === taskId)
          ?? workspace.boards.find((board) => board.idempotencyKey === idempotencyKey);
        mode = existing === undefined ? "created" : "resumed";
      }
    }

    const boardId = existing?.id ?? randomUUID();
    diagnostics.attemptedBoardId = boardId;
    const boardKey = existing?.idempotencyKey ?? idempotencyKey;
    const boardTaskId = existing?.taskId ?? taskId;

    const complexity = estimateComplexity(request);
    const targetCount = cardCountForComplexity(complexity);
    const phaseCount = Math.min(targetCount, phaseNames.length);
    const phaseIds = existing?.phases?.length > 0
      ? existing.phases.map((p) => p.id)
      : Array.from({ length: phaseCount }, () => randomUUID());

    const phases = existing?.phases?.length > 0
      ? existing.phases
      : phaseIds.map((id, i) => ({
          id,
          name: phaseNames[i % phaseNames.length],
          objective: i === 0 ? "Set up foundation and core infrastructure." : `Implement ${phaseNames[i % phaseNames.length].toLowerCase()} workstream.`,
          progress: 0,
          status: i === 0 ? "in_progress" : ("planned"),
        }));

    const cards = existing?.cards?.length > 0
      ? existing.cards
      : deriveCards(request, phaseIds, now);

    const board = {
      id: boardId,
      taskId: boardTaskId,
      idempotencyKey: boardKey,
      directoryId: directory.id,
      name: mode === "created" ? title : (existing?.name ?? title),
      description: existing?.description ?? `Relay board for ${repository.root}`,
      repository: repository.root,
      currentPhase: existing?.currentPhase ?? phases[0]?.name ?? "Foundation",
      progress: existing?.progress ?? 0,
      activeTasks: cards.filter((card) => card.columnId !== "verified").length,
      blockers: cards.filter((card) => card.blocked).length,
      lastActivity: now,
      owner: existing?.owner ?? "Claude/Codex",
      plan: request === "" ? (existing?.plan ?? "") : request,
      originalPrompt: existing?.originalPrompt ?? (request !== "" ? request : undefined),
      columns: existing?.columns ?? defaultColumns,
      cards,
      phases,
      context: existing?.context ?? deriveContext(request, repository, now, boardTaskId),
      decisions: existing?.decisions ?? [],
      activity: (existing?.activity ?? []).length > 0
        ? [
            activity(mode !== "created" ? "resumed board" : "created board", `${title} (${cards.length} cards, ${phases.length} phases)`, now, "green"),
            ...(existing?.activity ?? []),
          ]
        : [
            activity("created board", `${title} (${cards.length} cards, ${phases.length} phases)`, now, "green"),
          ],
    };

    addSharedTags(workspace, cards.flatMap((card) => card.tags ?? []));
    if (existing === undefined) workspace.boards.push(board);
    else workspace.boards = workspace.boards.map((item) => item.id === existing.id ? board : item);

    diagnostics.stage = "persist";
    saveWorkspace(workspace);

    diagnostics.stage = "config";
    config.repositories ??= {};
    for (const key of Object.keys(config.repositories)) {
      if (key !== repository.root && canonicalSafe(key)?.key === repository.rootKey) delete config.repositories[key];
    }
    config.repositories[repository.root] = { boardId, enabled: true };
    writeAtomic(configPath, config);

    diagnostics.stage = "verify";
    const persisted = readbackBoard(boardId);
    if (persisted === undefined || persisted.id !== boardId || persisted.directoryId !== directory.id || persisted.idempotencyKey !== boardKey || persisted.repository !== repository.root) {
      throw new Error("Board was written but failed read-back verification from the workspace file.");
    }

    try {
      if (existsSync(pendingPath(idempotencyKey))) rmSync(pendingPath(idempotencyKey));
    } catch {
      // non-fatal
    }

    console.log(JSON.stringify({
      ok: true,
      boardId,
      mode,
      verified: true,
      taskId: boardTaskId,
      idempotencyKey: boardKey,
      directoryId: directory.id,
      cardCount: cards.length,
      phaseCount: phases.length,
      complexity,
      repository,
      relayDataPath,
      configPath,
    }, null, 2));
  } catch (error) {
    recordFailure(diagnostics.stage, error, diagnostics, request);
  }
}

async function createCard() {
  const repository = detectRepository(arg("--cwd") ?? process.cwd());
  const config = loadConfig();
  const workspace = normalizeWorkspace(loadWorkspace());
  const board = findLinkedBoard(workspace, repository, config);
  if (board === undefined) throw new Error("No linked Relay board. Run create-board first or pass --board-id.");
  const payload = await readPayload();
  const now = new Date().toISOString();
  const title = arg("--title") ?? payload.title;
  if (typeof title !== "string" || title.trim() === "") throw new Error("create-card requires --title or JSON {\"title\":\"...\"} on stdin.");
  const phase = findPhase(board, arg("--phase") ?? payload.phase ?? payload.phaseId) ?? { id: randomUUID(), name: "Planning", objective: "", progress: 0, status: "planned" };
  if (!board.phases.some((item) => item.id === phase.id)) board.phases.push(phase);
  const column = findColumn(board, arg("--column") ?? payload.column ?? payload.columnId) ?? board.columns[0] ?? defaultColumns[0];
  if (!board.columns.some((item) => item.id === column.id)) board.columns.push(column);
  const tags = parseTags(payload.tags);
  const card = {
    id: randomUUID(),
    title: title.trim().slice(0, 180),
    description: String(payload.description ?? payload.body ?? "").slice(0, 4_000),
    columnId: column.id,
    phaseId: phase.id,
    type: cardType(payload.type),
    priority: cardPriority(payload.priority),
    tags,
    notes: [],
    progress: Number.isFinite(Number(payload.progress)) ? Math.max(0, Math.min(100, Number(payload.progress))) : 0,
    criteriaDone: 0,
    criteriaTotal: Number.isFinite(Number(payload.criteriaTotal)) ? Math.max(0, Number(payload.criteriaTotal)) : 1,
    blocked: payload.blocked === true,
    owner: String(payload.owner ?? agentName),
    updatedAt: now,
  };
  board.cards.push(card);
  // The first real card retires the seeded ones, so a board never shows a
  // fabricated "Implementation step 1" as active once actual work is recorded.
  const pruned = prunePlaceholders(board);
  board.activeTasks = board.cards.filter((item) => item.columnId !== "verified").length;
  board.blockers = board.cards.filter((item) => item.blocked).length;
  board.lastActivity = now;
  board.activity.unshift(activity("created card", card.title, now, "blue"));
  if (pruned.length > 0) {
    board.activity.unshift(activity("pruned placeholder cards", `${pruned.length} removed`, now, "gray"));
  }
  addSharedTags(workspace, tags);
  saveWorkspace(workspace);
  console.log(JSON.stringify({ ok: true, boardId: board.id, cardId: card.id, title: card.title, prunedPlaceholders: pruned }, null, 2));
}

/**
 * Retires seeded placeholder cards on an existing board. Needed because
 * boards created before placeholders were tagged still carry them, and the
 * CLI otherwise has no way to remove a card.
 */
async function pruneBoard() {
  const repository = detectRepository(arg("--cwd") ?? process.cwd());
  const config = loadConfig();
  const workspace = normalizeWorkspace(loadWorkspace());
  const board = findLinkedBoard(workspace, repository, config);
  if (board === undefined) throw new Error("No linked Relay board. Run create-board first or pass --board-id.");

  // Boards predating the placeholder tag: match the generated shape instead.
  // Deliberately narrow - it must never match a card someone actually wrote.
  const legacyPattern = /^\d+\.\s+\S/;
  for (const card of board.cards) {
    const tags = card.tags ?? [];
    if (tags.includes("placeholder")) continue;
    const looksGenerated = tags.includes("agent-created")
      && legacyPattern.test(card.title)
      && /^Implement .* with tests and documentation\.$/.test(card.description ?? "")
      && (card.notes ?? []).length === 0
      && (card.progress ?? 0) <= 1;
    if (looksGenerated) card.tags = [...tags, "placeholder"];
  }

  const removed = prunePlaceholders(board);
  const now = new Date().toISOString();
  if (removed.length > 0) {
    board.activeTasks = board.cards.filter((item) => item.columnId !== "verified").length;
    board.blockers = board.cards.filter((item) => item.blocked).length;
    board.lastActivity = now;
    board.activity.unshift(activity("pruned placeholder cards", `${removed.length} removed`, now, "gray"));
    saveWorkspace(workspace);
  }
  console.log(JSON.stringify({
    ok: true,
    boardId: board.id,
    removed,
    remaining: board.cards.map((card) => card.title),
  }, null, 2));
}

function cardType(value) {
  const allowed = new Set(["bug", "decision", "feature", "research", "security", "task", "test"]);
  return allowed.has(value) ? value : "task";
}

function cardPriority(value) {
  const allowed = new Set(["critical", "high", "low", "normal", "urgent"]);
  return allowed.has(value) ? value : "normal";
}

async function addNote() {
  const repository = detectRepository(arg("--cwd") ?? process.cwd());
  const config = loadConfig();
  const workspace = normalizeWorkspace(loadWorkspace());
  const board = findLinkedBoard(workspace, repository, config);
  if (board === undefined) throw new Error("No linked Relay board. Run create-board first or pass --board-id.");
  const payload = await readPayload();
  const card = activeCard(board, arg("--card-id") ?? payload.cardId);
  if (card === undefined) throw new Error("No target card found. Pass --card-id or create a card first.");
  const body = String(payload.body ?? payload.note ?? payload.text ?? "").trim();
  if (body === "") throw new Error("add-note requires note text on stdin.");
  const now = new Date().toISOString();
  card.notes ??= [];
  card.notes.unshift({ id: randomUUID(), body, author: agentName, createdAt: now });
  card.updatedAt = now;
  board.lastActivity = now;
  board.activity.unshift(activity("added note to", card.title, now, "violet"));
  saveWorkspace(workspace);
  console.log(JSON.stringify({ ok: true, boardId: board.id, cardId: card.id, noteId: card.notes[0].id }, null, 2));
}

async function recordContext() {
  const repository = detectRepository(arg("--cwd") ?? process.cwd());
  const config = loadConfig();
  const workspace = normalizeWorkspace(loadWorkspace());
  const board = findLinkedBoard(workspace, repository, config);
  if (board === undefined) throw new Error("No linked Relay board. Run create-board first or pass --board-id.");
  const payload = await readPayload();
  const now = new Date().toISOString();
  const title = String(arg("--title") ?? payload.title ?? "Context update").trim();
  const content = String(payload.content ?? payload.body ?? payload.text ?? "").trim();
  if (content === "") throw new Error("record-context requires content on stdin.");
  board.context.unshift({
    id: randomUUID(),
    category: contextCategory(payload.category ?? arg("--category")),
    title,
    content,
    confidence: payload.confidence === "Medium" ? "Medium" : "High",
    updatedAt: now,
  });
  board.lastActivity = now;
  board.activity.unshift(activity("recorded context", title, now, "green"));
  saveWorkspace(workspace);
  console.log(JSON.stringify({ ok: true, boardId: board.id, contextId: board.context[0].id }, null, 2));
}

function contextCategory(value) {
  const allowed = new Set(["Architecture", "Current state", "Decision", "Important file", "Warning"]);
  return allowed.has(value) ? value : "Current state";
}

async function recordDecision() {
  const repository = detectRepository(arg("--cwd") ?? process.cwd());
  const config = loadConfig();
  const workspace = normalizeWorkspace(loadWorkspace());
  const board = findLinkedBoard(workspace, repository, config);
  if (board === undefined) throw new Error("No linked Relay board. Run create-board first or pass --board-id.");
  const payload = await readPayload();
  const now = new Date().toISOString();
  const title = String(arg("--title") ?? payload.title ?? "Decision").trim();
  const decision = String(payload.decision ?? payload.body ?? payload.text ?? "").trim();
  if (decision === "") throw new Error("record-decision requires decision text on stdin.");
  board.decisions.unshift({
    id: randomUUID(),
    title,
    decision,
    reason: String(payload.reason ?? "Recorded by Relay integration.").trim(),
    status: payload.status === "Proposed" ? "Proposed" : "Accepted",
  });
  board.context.unshift({
    id: randomUUID(),
    category: "Decision",
    title,
    content: decision,
    confidence: "High",
    updatedAt: now,
  });
  board.lastActivity = now;
  board.activity.unshift(activity("recorded decision", title, now, "green"));
  saveWorkspace(workspace);
  console.log(JSON.stringify({ ok: true, boardId: board.id, decisionId: board.decisions[0].id }, null, 2));
}

async function checkpoint() {
  const repository = detectRepository(arg("--cwd") ?? process.cwd());
  const config = loadConfig();
  const workspace = normalizeWorkspace(loadWorkspace());
  const board = findLinkedBoard(workspace, repository, config);
  if (board === undefined) throw new Error("No linked Relay board. Run create-board first or pass --board-id.");
  const payload = await readPayload();
  const card = activeCard(board, arg("--card-id") ?? payload.cardId);
  const now = new Date().toISOString();
  const lines = [
    payload.summary ?? payload.body ?? payload.text,
    listLine("Changed files", payload.changedFiles ?? repository.changedFiles),
    listLine("Commands", payload.commandsRun ?? payload.commands),
    listLine("Tests", payload.tests),
    listLine("Known issues", payload.knownIssues),
    listLine("Remaining work", payload.remainingWork),
    payload.nextTask === undefined ? undefined : `Next: ${payload.nextTask}`,
  ].filter((line) => typeof line === "string" && line.trim() !== "");
  if (lines.length === 0) throw new Error("checkpoint requires a summary, evidence, or remaining work.");
  if (card !== undefined) {
    card.notes ??= [];
    card.notes.unshift({ id: randomUUID(), body: lines.join("\n"), author: agentName, createdAt: now });
    if (Number.isFinite(Number(payload.progress))) card.progress = Math.max(0, Math.min(100, Number(payload.progress)));
    else card.progress = Math.max(clampPercent(card.progress), 25);
    if (card.columnId !== "verified") card.columnId = "progress";
    if (payload.blocked === true) card.blocked = true;
    if (payload.complete === true) {
      card.progress = 100;
      const verified = board.columns.find((column) => column.id === "verified");
      if (verified !== undefined) card.columnId = verified.id;
    }
    card.updatedAt = now;
  }
  // Deduplicate: skip if exact same content already exists in last 10 entries
  const entryContent = lines.join("\n");
  const recentContext = board.context ?? [];
  const isDuplicate = recentContext.slice(0, 10).some((item) => item.content !== undefined && contentHash(item.content) === contentHash(entryContent));
  if (!isDuplicate) {
    board.context.unshift({
      id: randomUUID(),
      category: payload.blocked === true ? "Warning" : "Current state",
      title: String(payload.title ?? (card === undefined ? "Agent checkpoint" : `Checkpoint: ${card.title}`)).slice(0, 140),
      content: entryContent,
      confidence: "High",
      updatedAt: now,
    });
  }

  // Compact: if over MAX_CONTEXT_ENTRIES, merge oldest "Current state" entries into a rolling summary
  if ((board.context ?? []).length > MAX_CONTEXT_ENTRIES) {
    const currentStateEntries = board.context.filter((item) => item.category === "Current state");
    if (currentStateEntries.length > 5) {
      const toMerge = currentStateEntries.slice(2); // keep newest 2, merge rest
      const summary = toMerge.map((item) => `- ${item.title}: ${String(item.content ?? "").slice(0, 160)}`).join("\n");
      const mergedId = randomUUID();
      board.context = board.context.filter((item) => !toMerge.includes(item) || item.category !== "Current state");
      board.context.unshift({
        id: mergedId,
        category: "Current state",
        title: "Consolidated checkpoint summary",
        content: summary.length > 4000 ? summary.slice(0, 4000) + "\n... (truncated)" : summary,
        confidence: "Medium",
        updatedAt: now,
      });
    }
  }
  board.activeTasks = board.cards.filter((item) => item.columnId !== "verified").length;
  board.blockers = board.cards.filter((item) => item.blocked).length;
  updatePhaseTimeline(board, card, payload);
  updateBoardProgress(board);
  board.lastActivity = now;
  board.activity.unshift(activity(payload.complete === true ? "completed checkpoint for" : "checkpointed", card?.title ?? board.name, now, payload.blocked === true ? "orange" : "blue"));
  saveWorkspace(workspace);
  console.log(JSON.stringify({ ok: true, boardId: board.id, cardId: card?.id ?? null, contextId: board.context[0].id }, null, 2));
}

function updatePhaseTimeline(board, card, payload) {
  if (!Array.isArray(board.phases) || board.phases.length === 0) return;
  const phase = card?.phaseId === undefined
    ? board.phases[0]
    : board.phases.find((item) => item.id === card.phaseId) ?? board.phases[0];
  if (phase === undefined) return;
  const relatedCards = board.cards.filter((item) => item.phaseId === phase.id);
  if (relatedCards.length === 0) {
    phase.progress = payload.complete === true ? 100 : clampPercent(phase.progress);
  } else {
    phase.progress = Math.round(relatedCards.reduce((sum, item) => sum + clampPercent(item.progress), 0) / relatedCards.length);
  }
  phase.status = phase.progress >= 100 ? "complete" : phase.progress > 0 ? "in_progress" : "planned";
  board.currentPhase = board.phases.find((item) => item.status === "in_progress")?.name
    ?? board.phases.find((item) => item.status === "planned")?.name
    ?? phase.name;
}

function updateBoardProgress(board) {
  if (!Array.isArray(board.cards) || board.cards.length === 0) {
    board.progress = clampPercent(board.progress);
    return;
  }
  board.progress = Math.round(board.cards.reduce((sum, card) => sum + clampPercent(card.progress), 0) / board.cards.length);
}

function clampPercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
}

function listLine(label, value) {
  if (Array.isArray(value) && value.length > 0) return `${label}: ${value.slice(0, 12).join(", ")}`;
  if (typeof value === "string" && value.trim() !== "") return `${label}: ${value.trim()}`;
  return undefined;
}

async function repairBoard() {
  const repository = detectRepository(arg("--cwd") ?? process.cwd());
  const config = loadConfig();
  const workspace = normalizeWorkspace(loadWorkspace());
  const boardId = arg("--board-id");
  const board = boardId !== undefined
    ? workspace.boards.find((b) => b.id === boardId)
    : findLinkedBoard(workspace, repository, config);
  if (board === undefined) {
    console.log("[RELAY] No board found to repair. Use --board-id or run from a linked repo.");
    return;
  }
  const report = [];

  if (Array.isArray(board.phases) && board.phases.length > 1) {
    const nameGroups = new Map();
    for (const phase of board.phases) {
      const key = phase.name.trim().toLowerCase();
      if (!nameGroups.has(key)) nameGroups.set(key, []);
      nameGroups.get(key).push(phase);
    }
    for (const [name, group] of nameGroups) {
      if (group.length <= 1) continue;
      const kept = group[0];
      const removed = group.slice(1);
      const removedIds = new Set(removed.map((p) => p.id));
      for (const card of board.cards ?? []) {
        if (removedIds.has(card.phaseId)) card.phaseId = kept.id;
      }
      board.phases = board.phases.filter((p) => !removedIds.has(p.id));
      report.push(`Merged ${removed.length} duplicate "${group[0].name}" phases into one (${removedIds.size} cards reassigned).`);
    }
  }

  const seenActivityIds = new Set();
  board.activity = (board.activity ?? []).filter((a) => {
    if (a.id === undefined) return true;
    if (seenActivityIds.has(a.id)) return false;
    seenActivityIds.add(a.id);
    return true;
  });
  if (seenActivityIds.size < (board.activity ?? []).length + (board.activity ?? []).filter((a) => seenActivityIds.has(a.id)).length) {
    report.push("Removed duplicate activity entries.");
  }

  const genericCards = (board.cards ?? []).filter((c) =>
    c.title === "Plan first implementation card" || c.title.startsWith("1. Plan first"));
  if (genericCards.length > 0) {
    for (const card of genericCards) {
      if (card.columnId !== "progress" || card.progress <= 1) {
        board.cards = board.cards.filter((c) => c.id !== card.id);
        report.push(`Removed generic card "${card.title}".`);
      }
    }
    const existingPhases = board.phases ?? [];
    const phasePool = existingPhases.length > 0 ? existingPhases.map((p) => p.id) : [];
    if (board.plan && board.plan.length > 20 && board.cards.length < 3) {
      const newPhases = phasePool.length >= 3 ? phasePool : Array.from({ length: 3 }, () => randomUUID());
      const generated = deriveCards(board.plan, newPhases, new Date().toISOString());
      for (const card of generated) {
        if (!board.cards.some((c) => c.title === card.title)) {
          board.cards.push(card);
          report.push(`Created card "${card.title}" from plan.`);
        }
      }
    }
    board.activeTasks = board.cards.filter((c) => c.columnId !== "verified").length;
    board.blockers = board.cards.filter((c) => c.blocked).length;
    if (board.cards.length > 0) {
      board.progress = Math.round(board.cards.reduce((s, c) => s + clampPercent(c.progress), 0) / board.cards.length);
    }
  }

  // Compact context: deduplicate by content hash, merge old "Current state" into rolling summary
  const seenHashes = new Set();
  board.context = (board.context ?? []).filter((item) => {
    if (item.content === undefined) return true;
    const hash = contentHash(item.content);
    if (seenHashes.has(hash)) return false;
    seenHashes.add(hash);
    return true;
  });
  const contextDupesRemoved = (board.context ?? []).length - seenHashes.size;
  if (contextDupesRemoved > 0) report.push(`Removed ${contextDupesRemoved} duplicate context entries.`);
  if ((board.context ?? []).length > MAX_CONTEXT_ENTRIES) {
    board.context = board.context.slice(0, MAX_CONTEXT_ENTRIES);
    report.push("Truncated context to max size.");
  }

  board.lastActivity = new Date().toISOString();
  board.activity.unshift(activity("repaired board", `${board.name} - ${report.join("; ")}`, new Date().toISOString(), "green"));
  saveWorkspace(workspace);
  console.log(JSON.stringify({
    ok: true,
    boardId: board.id,
    repairs: report.length > 0 ? report : ["No repairs needed."],
  }, null, 2));
}

async function diagnostics() {
  const repository = detectRepository(arg("--cwd") ?? process.cwd());
  const config = loadConfig();
  const workspace = normalizeWorkspace(loadWorkspace());
  const board = findLinkedBoard(workspace, repository, config);
  if (board === undefined) {
    console.log("[RELAY] No board found.");
    return;
  }
  const statusText = buildResumeOutput(board, repository);
  const statusTokens = estimateTokens(statusText);

  const sections = [
    { name: "board metadata", text: JSON.stringify({ id: board.id, name: board.name, repository: board.repository }) },
    { name: "phases", text: JSON.stringify(board.phases) },
    { name: "cards", text: JSON.stringify(board.cards.map((c) => ({ id: c.id, title: c.title, status: c.columnId, progress: c.progress }))) },
    { name: "context", text: JSON.stringify((board.context ?? []).slice(0, 5)) },
    { name: "activity", text: JSON.stringify((board.activity ?? []).slice(0, 5)) },
    { name: "decisions", text: JSON.stringify(board.decisions ?? []) },
    { name: "blockers", text: JSON.stringify(board.cards?.filter((c) => c.blocked).map((c) => c.title) ?? []) },
  ];

  const result = {
    boardId: board.id,
    boardName: board.name,
    taskId: board.taskId,
    idempotencyKey: board.idempotencyKey,
    estimatedInputTokens: {
      total: statusTokens,
      sections: sections.map((s) => ({ section: s.name, tokens: estimateTokens(s.text) })),
    },
    resumePayloadTokens: statusTokens,
    contextEntryCount: (board.context ?? []).length,
    cardCount: (board.cards ?? []).length,
    phaseCount: (board.phases ?? []).length,
    activityCount: (board.activity ?? []).length,
    duplicateContextCount: countDuplicateContext(board),
    activeCard: board.cards?.find((card) => card.archivedAt === undefined && card.columnId === "progress")?.title ?? null,
    configLink: findRepoLink(config, repository)?.link ?? null,
    repository: {
      root: repository.root,
      branch: repository.branch,
      head: repository.headCommit,
      dirty: repository.dirty,
    },
  };
  console.log(JSON.stringify(result, null, 2));
}

function countDuplicateContext(board) {
  const seen = new Set();
  let dupes = 0;
  for (const item of board.context ?? []) {
    if (item.content === undefined) continue;
    const hash = contentHash(item.content);
    if (seen.has(hash)) dupes++;
    else seen.add(hash);
  }
  return dupes;
}

function help() {
  console.log(`Relay progress commands:
  status --cwd <path>
  resume --cwd <path>
  diagnostics --cwd <path>
      Shows estimated token counts per section for the linked board.
  create-board --cwd <path> --title <name> < request.md
      Creates a NEW board for this task by default. Auto-resumes existing
      board when request looks like a continuation.
      --task-id <id>            attach to board with this exact taskId
      --board-id <id>           attach to a specific existing board
      --continue-board <name>   attach to the existing board named <name>
      --continue                attach to the existing board named <title>
      --idempotency-key <key>   override the derived idempotency key
  create-card --title <name> [--column Ready] [--phase Foundation] [--tags ui,api] < details.json
  add-note [--card-id <id>] < note.txt
  record-context --title <name> [--category "Current state"] < context.txt
  record-decision --title <name> < decision.json
  checkpoint [--card-id <id>] < checkpoint.json
  repair-board [--board-id <id>]
      Merges duplicate phases, deduplicates activity, compacts context, replaces generic cards.
  prune-placeholders [--board-id <id>]
      Removes seeded placeholder cards once real cards exist. Runs automatically after create-card.`);
}

const command = process.argv[2] ?? "status";
if (command === "status") await status();
else if (command === "resume") await resume();
else if (command === "create-board") await createBoard();
else if (command === "create-card") await createCard();
else if (command === "add-note") await addNote();
else if (command === "record-context") await recordContext();
else if (command === "record-decision") await recordDecision();
else if (command === "checkpoint") await checkpoint();
else if (command === "repair-board") await repairBoard();
else if (command === "prune-placeholders") await pruneBoard();
else if (command === "diagnostics") await diagnostics();
else if (command === "help" || command === "--help" || command === "-h") help();
else {
  console.error(`Unknown command: ${command}`);
  process.exit(2);
}

#!/usr/bin/env node
/**
 * PostToolUse hook: keeps the Relay discovery index current as the agent works.
 *
 * When an agent creates, edits, moves or deletes a file, that file's stored
 * summary goes stale immediately. This hook re-indexes only the touched paths,
 * so the index stays trustworthy without ever triggering a repository scan.
 *
 * Deliberately silent. It writes nothing to stdout and only reports failures on
 * stderr, because anything printed here is paid for in the agent's context on
 * every single edit.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".java", ".rb", ".php",
  ".css", ".scss", ".less", ".html", ".vue", ".svelte",
  ".swift", ".kt", ".dart",
  ".json", ".yaml", ".yml", ".toml",
]);

function workspacePath() {
  return `${homedir()}/Library/Application Support/Relay/relay-data/workspace.json`;
}

/** Must match discoveryKey() in the desktop main process, or lookups miss. */
function discoveryKey(repoPath) {
  return path.resolve(repoPath).replace(/\/+$/, "").toLowerCase();
}

function detectRepoRoot(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return cwd;
  }
}

/**
 * Collects the file paths a tool call touched. Bash is intentionally ignored:
 * its command string cannot be parsed into affected paths reliably, and
 * guessing would corrupt the index.
 */
function touchedPaths(payload) {
  const input = payload.tool_input ?? payload.toolInput ?? {};
  const found = [];
  for (const key of ["file_path", "filePath", "path", "notebook_path"]) {
    if (typeof input[key] === "string") found.push(input[key]);
  }
  // MultiEdit and apply_patch style payloads carry a list of edits.
  for (const key of ["edits", "changes", "files"]) {
    const list = input[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item === "string") found.push(item);
      else if (item !== null && typeof item === "object") {
        for (const nested of ["file_path", "filePath", "path"]) {
          if (typeof item[nested] === "string") found.push(item[nested]);
        }
      }
    }
  }
  return [...new Set(found)];
}

function extractExports(content, ext) {
  const exports = [];
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    for (const m of content.matchAll(/export\s+(?:default\s+)?(?:function|const|class|type|interface|enum|async\s+function)\s+(\w+)/g)) {
      if (m[1] !== undefined) exports.push(m[1]);
    }
    const block = content.match(/module\.exports\s*=\s*\{([^}]*)\}/);
    if (block?.[1] !== undefined) {
      for (const part of block[1].split(",")) {
        const name = (part.split(":")[0] ?? "").trim();
        if (/^\w+$/.test(name)) exports.push(name);
      }
    }
  }
  if (ext === ".py") {
    for (const m of content.matchAll(/^(?:async\s+)?def\s+(\w+)|^class\s+(\w+)/gm)) {
      const name = m[1] ?? m[2];
      if (name !== undefined) exports.push(name);
    }
  }
  return exports.slice(0, 8);
}

const PURPOSE_PATTERNS = [
  [/auth|login|session|oauth|jwt|token/i, "Authentication and authorization"],
  [/payment|stripe|billing|checkout|invoice/i, "Payment and billing processing"],
  [/database|db|schema|model|entity|repository|prisma|drizzle/i, "Database model and data access"],
  [/api|route|endpoint|controller|handler/i, "API route and request handler"],
  [/middleware/i, "Request middleware and interceptors"],
  [/hook|use[A-Z]/i, "React hook"],
  [/component|ui|button|card|modal|form|input|dialog/i, "UI component"],
  [/layout|page/i, "Page layout and routing"],
  [/style|css|theme/i, "Styles and design tokens"],
  [/test|spec|e2e|vitest|jest/i, "Tests and test utilities"],
  [/util|helper|common|shared|lib/i, "Shared utilities and helpers"],
  [/config|setting|env|constant/i, "Configuration and constants"],
  [/type|interface|enum/i, "TypeScript type definitions"],
  [/index/i, "Module index and re-exports"],
];

function inferPurpose(relativePath, ext) {
  for (const [pattern, purpose] of PURPOSE_PATTERNS) {
    if (pattern.test(relativePath)) return purpose;
  }
  const name = path.basename(relativePath, ext);
  return `${(name[0] ?? "").toUpperCase()}${name.slice(1)} module`;
}

function buildEntry(repoRoot, relativePath, discoveredBy) {
  const absPath = path.resolve(repoRoot, relativePath);
  let content;
  try {
    content = readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  const ext = path.extname(relativePath).toLowerCase();
  const importantExports = extractExports(content, ext);
  const segments = relativePath.split(path.sep);
  const feature = segments.length > 1 && /^[a-z][a-z0-9-]+$/i.test(segments[0] ?? "") ? segments[0] : "";
  let lastModified = new Date(0).toISOString();
  try {
    lastModified = statSync(absPath).mtime.toISOString();
  } catch {
    // Keep the epoch default; the entry is still usable.
  }
  const now = new Date().toISOString();
  return {
    filePath: relativePath,
    purpose: inferPurpose(relativePath, ext),
    importantExports,
    relatedFiles: [],
    features: feature ? [feature] : [],
    dependencies: [],
    lastModified,
    contentHash: createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16),
    lastDiscovered: now,
    discoveredBy,
    confidence: importantExports.length > 0 ? "high" : "medium",
    status: "current",
  };
}

function atomicWrite(filePath, data) {
  const temp = `${filePath}.${process.pid}.tmp`;
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(temp, data, { mode: 0o600 });
  renameSync(temp, filePath);
}

/**
 * How long a file must sit untouched before it is worth indexing.
 *
 * Agents rewrite the same file several times in a row — write it, fix a type
 * error, rename a symbol. Indexing each of those captured half-finished states
 * and paid a workspace write per edit. Waiting for quiet means the index
 * records the file as it ended up, once.
 */
const QUIET_MS = Number(process.env.RELAY_DISCOVERY_QUIET_MS ?? 90_000);

/**
 * Pending edits live in plugin-owned storage, NOT workspace.json. The desktop
 * app keeps workspace.json in memory, so touching it on every edit invites the
 * same write race this debounce is partly meant to reduce.
 *
 * Shape: { "<repo key>": { "<relative path>": <epoch ms> } }
 */
function pendingPath() {
  return `${homedir()}/.relay/integrations/discovery-pending.json`;
}

function readPending() {
  try {
    return JSON.parse(readFileSync(pendingPath(), "utf8"));
  } catch {
    return {};
  }
}

function writePending(pending) {
  try {
    atomicWrite(pendingPath(), JSON.stringify(pending, null, 2));
  } catch {
    // A lost pending file costs a delayed re-index, not correctness — the next
    // full scan still picks the file up. Never fail the agent's tool call.
  }
}

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

let payload = {};
try {
  payload = JSON.parse(raw || "{}");
} catch {
  process.exit(0);
}

// SessionEnd passes --flush: the session is over, so every pending file is
// final regardless of how recently it was touched.
const flushAll = process.argv.includes("--flush");

const cwd = payload.cwd ?? payload.workspace?.current_dir ?? process.cwd();
const repoRoot = detectRepoRoot(cwd);
const candidates = touchedPaths(payload);
// On a normal edit with nothing touched there is nothing to do. On a flush
// there is: the queue is drained even though this invocation touched no file.
if (candidates.length === 0 && !flushAll) process.exit(0);

const wsPath = workspacePath();
if (!existsSync(wsPath)) process.exit(0);

let workspace;
try {
  workspace = JSON.parse(readFileSync(wsPath, "utf8"));
} catch {
  process.exit(0);
}

const key = discoveryKey(repoRoot);
const discoveries = workspace.discoveries ?? {};
const discovery = discoveries[key];
// No index yet means discovery has never been run for this repo. Creating one
// from a single edited file would produce a misleading one-entry index, so
// stay out of the way until a real scan has happened.
if (discovery === undefined || !Array.isArray(discovery.entries)) process.exit(0);

// Stage 1: record what this tool call touched. Re-touching a path that is
// already pending pushes its deadline out, so a file under active editing is
// never indexed mid-flight.
const pending = readPending();
const repoPending = pending[key] ?? {};
const now = Date.now();

for (const candidate of candidates) {
  const relativePath = path.isAbsolute(candidate) ? path.relative(repoRoot, candidate) : candidate;
  // A path outside the repo would resolve to ../.. and poison the index.
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) continue;
  if (!SOURCE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) continue;
  repoPending[relativePath] = now;
}

// Stage 2: index only the paths that have gone quiet. Everything else stays
// queued for a later invocation or for the SessionEnd flush.
const due = Object.entries(repoPending)
  .filter(([, touchedAt]) => flushAll || now - touchedAt >= QUIET_MS)
  .map(([relativePath]) => relativePath);

if (due.length === 0) {
  pending[key] = repoPending;
  writePending(pending);
  process.exit(0);
}

const entries = discovery.entries.slice();
let changed = 0;

for (const relativePath of due) {
  delete repoPending[relativePath];
  const index = entries.findIndex((entry) => entry.filePath === relativePath);
  const entry = buildEntry(repoRoot, relativePath, "codex");

  if (entry === null) {
    // Unreadable now means the tool deleted or moved it.
    if (index !== -1) { entries.splice(index, 1); changed += 1; }
    continue;
  }
  if (index === -1) {
    entries.push(entry);
    changed += 1;
  } else if (entries[index].contentHash !== entry.contentHash) {
    // Carry forward relationship data the full scan derived; a single-file
    // re-index cannot recompute inbound references without walking the repo.
    entry.relatedFiles = entries[index].relatedFiles ?? [];
    entry.dependencies = entries[index].dependencies ?? [];
    entries[index] = entry;
    changed += 1;
  }
}

// The queue is cleared for everything indexed above, whether or not the content
// actually differed — a re-check that found no change is still a completed
// check, and leaving it queued would retry it forever.
if (Object.keys(repoPending).length === 0) delete pending[key];
else pending[key] = repoPending;
writePending(pending);

if (changed === 0) process.exit(0);

entries.sort((a, b) => a.filePath.localeCompare(b.filePath));

// Re-read immediately before writing to shrink the window in which the desktop
// app could have written its own update between our read and our write.
try {
  const fresh = JSON.parse(readFileSync(wsPath, "utf8"));
  if (fresh.discoveries?.[key] !== undefined) {
    fresh.discoveries[key] = {
      ...fresh.discoveries[key],
      entries,
      discoveryCount: entries.length,
      lastIncrementalDiscovery: new Date().toISOString(),
      version: (fresh.discoveries[key].version ?? 1) + 1,
    };
    atomicWrite(wsPath, JSON.stringify(fresh, null, 2));
  }
} catch (error) {
  console.error(`Relay: could not update discovery index (${error instanceof Error ? error.message : String(error)})`);
}

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Covers the PostToolUse discovery-index hook: the mechanism that keeps the
 * Relay index current while an agent edits files, without ever triggering a
 * repository scan.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const claudeHook = path.join(repoRoot, "integrations/claude-code/hooks/discovery-index.mjs");
const codexHook = path.join(repoRoot, "integrations/codex/hooks/discovery-index.mjs");

interface IndexEntry {
  filePath: string;
  importantExports: string[];
  discoveredBy: string;
}

interface StoredIndex {
  entries: IndexEntry[];
  version: number;
  discoveryCount: number;
}

let workDir: string;
let home: string;
let workspaceFile: string;

function discoveryKey(p: string): string {
  return path.resolve(p).replace(/\/+$/, "").toLowerCase();
}

function readIndex(): StoredIndex {
  const workspace = JSON.parse(readFileSync(workspaceFile, "utf8")) as {
    discoveries: Record<string, StoredIndex>;
  };
  const index = workspace.discoveries[discoveryKey(workDir)];
  if (index === undefined) throw new Error("index missing");
  return index;
}

function paths(): string[] {
  return readIndex().entries.map((e) => e.filePath);
}

/**
 * Runs the hook with the debounce disabled, so these tests exercise indexing
 * correctness rather than the wait. The debounce itself is covered separately
 * in the "debounce" block below.
 */
function runHook(toolInput: Record<string, unknown>, hook = claudeHook): void {
  execFileSync("node", [hook], {
    input: JSON.stringify({ cwd: workDir, tool_name: "Edit", tool_input: toolInput }),
    env: { ...process.env, HOME: home, RELAY_DISCOVERY_QUIET_MS: "0" },
    encoding: "utf8",
  });
}

/** Runs the hook with the real debounce active, optionally flushing. */
function runHookDebounced(toolInput: Record<string, unknown>, args: string[] = []): void {
  execFileSync("node", [claudeHook, ...args], {
    input: JSON.stringify({ cwd: workDir, tool_name: "Edit", tool_input: toolInput }),
    env: { ...process.env, HOME: home, RELAY_DISCOVERY_QUIET_MS: "60000" },
    encoding: "utf8",
  });
}

function seedIndex(entries: Array<{ filePath: string; contentHash: string }>): void {
  mkdirSync(path.dirname(workspaceFile), { recursive: true });
  writeFileSync(workspaceFile, JSON.stringify({
    directories: [],
    boards: [],
    discoveries: {
      [discoveryKey(workDir)]: {
        repoPath: workDir,
        entries: entries.map((e) => ({
          ...e,
          purpose: "seeded",
          importantExports: [],
          relatedFiles: [],
          features: ["src"],
          dependencies: [],
          lastModified: new Date(0).toISOString(),
          lastDiscovered: new Date(0).toISOString(),
          discoveredBy: "relay-desktop",
          confidence: "medium",
          status: "current",
        })),
        features: [],
        lastFullDiscovery: new Date(0).toISOString(),
        coverage: 100,
        staleRelationshipCount: 0,
        discoveryCount: entries.length,
        version: 1,
      },
    },
  }, null, 2));
}

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "relay-hook-"));
  home = path.join(workDir, "home");
  workspaceFile = path.join(home, "Library/Application Support/Relay/relay-data/workspace.json");
  mkdirSync(path.join(workDir, "src"), { recursive: true });
  writeFileSync(path.join(workDir, "src", "a.ts"), "export function alpha() {}\n");
  writeFileSync(path.join(workDir, "src", "b.ts"), "export const beta = 1;\n");
  seedIndex([
    { filePath: path.join("src", "a.ts"), contentHash: "stalehash0000000" },
    { filePath: path.join("src", "b.ts"), contentHash: "stalehash1111111" },
  ]);
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("discovery-index PostToolUse hook", () => {
  it("re-indexes an edited file and records the agent that touched it", () => {
    writeFileSync(path.join(workDir, "src", "a.ts"), "export function alpha() { return 1; }\nexport function alpha2() {}\n");
    runHook({ file_path: path.join(workDir, "src", "a.ts") });

    const entry = readIndex().entries.find((e) => e.filePath === path.join("src", "a.ts"));
    expect(entry?.importantExports).toEqual(expect.arrayContaining(["alpha", "alpha2"]));
    expect(entry?.discoveredBy).toBe("claude-code");
  });

  it("adds a file that was never indexed, without scanning the repo", () => {
    writeFileSync(path.join(workDir, "src", "c.ts"), "export class Gamma {}\n");
    runHook({ file_path: path.join(workDir, "src", "c.ts") });

    expect(paths()).toContain(path.join("src", "c.ts"));
    // Only the touched file is added; nothing else is rediscovered.
    expect(paths()).toHaveLength(3);
  });

  it("drops the entry when a file is deleted", () => {
    unlinkSync(path.join(workDir, "src", "b.ts"));
    runHook({ file_path: path.join(workDir, "src", "b.ts") });

    expect(paths()).not.toContain(path.join("src", "b.ts"));
    expect(readIndex().discoveryCount).toBe(1);
  });

  it("handles a move as a delete plus an add", () => {
    const from = path.join(workDir, "src", "b.ts");
    const to = path.join(workDir, "src", "moved.ts");
    writeFileSync(to, readFileSync(from, "utf8"));
    unlinkSync(from);
    runHook({ file_path: from });
    runHook({ file_path: to });

    expect(paths()).not.toContain(path.join("src", "b.ts"));
    expect(paths()).toContain(path.join("src", "moved.ts"));
  });

  it("ignores paths outside the repository", () => {
    const outside = path.join(tmpdir(), "relay-outside.ts");
    writeFileSync(outside, "export const evil = 1;\n");
    const before = readIndex().version;
    runHook({ file_path: outside });

    expect(paths()).toHaveLength(2);
    expect(readIndex().version).toBe(before);
    rmSync(outside, { force: true });
  });

  it("ignores non-source files", () => {
    writeFileSync(path.join(workDir, "notes.txt"), "not source\n");
    runHook({ file_path: path.join(workDir, "notes.txt") });
    expect(paths()).toHaveLength(2);
  });

  it("does not bump the version when nothing actually changed", () => {
    runHook({ file_path: path.join(workDir, "src", "a.ts") });
    const afterFirst = readIndex().version;
    runHook({ file_path: path.join(workDir, "src", "a.ts") });
    // A second identical edit must be a no-op, or every tool call rewrites
    // workspace.json and the desktop app reloads for nothing.
    expect(readIndex().version).toBe(afterFirst);
  });

  it("stays out of the way when no index exists for the repo", () => {
    writeFileSync(workspaceFile, JSON.stringify({ directories: [], boards: [] }, null, 2));
    runHook({ file_path: path.join(workDir, "src", "a.ts") });
    const workspace = JSON.parse(readFileSync(workspaceFile, "utf8")) as { discoveries?: unknown };
    // Building a one-entry index from a single edit would be misleading.
    expect(workspace.discoveries).toBeUndefined();
  });

  it("collects paths from MultiEdit style payloads", () => {
    writeFileSync(path.join(workDir, "src", "c.ts"), "export class Gamma {}\n");
    execFileSync("node", [claudeHook], {
      input: JSON.stringify({
        cwd: workDir,
        tool_name: "MultiEdit",
        tool_input: { edits: [{ file_path: path.join(workDir, "src", "c.ts") }] },
      }),
      env: { ...process.env, HOME: home, RELAY_DISCOVERY_QUIET_MS: "0" },
      encoding: "utf8",
    });
    expect(paths()).toContain(path.join("src", "c.ts"));
  });

  it("the codex hook behaves identically but attributes to codex", () => {
    writeFileSync(path.join(workDir, "src", "a.ts"), "export function alpha() { return 2; }\n");
    runHook({ file_path: path.join(workDir, "src", "a.ts") }, codexHook);
    const entry = readIndex().entries.find((e) => e.filePath === path.join("src", "a.ts"));
    expect(entry?.discoveredBy).toBe("codex");
  });

  describe("debounce", () => {
    const target = () => path.join(workDir, "src", "a.ts");

    function exportsOf(relPath: string): string[] | undefined {
      return readIndex().entries.find((e) => e.filePath === relPath)?.importantExports;
    }

    it("does not index a file that was just edited", () => {
      writeFileSync(target(), "export function alpha() {}\nexport function pendingMarker() {}\n");
      runHookDebounced({ file_path: target() });
      // Still mid-edit as far as the hook is concerned, so the index must
      // continue to describe the previous, settled version of the file.
      expect(exportsOf(path.join("src", "a.ts"))).not.toContain("pendingMarker");
    });

    it("queues the path rather than dropping it", () => {
      writeFileSync(target(), "export function alpha() {}\nexport function pendingMarker() {}\n");
      runHookDebounced({ file_path: target() });
      const pending = JSON.parse(
        readFileSync(path.join(home, ".relay", "integrations", "discovery-pending.json"), "utf8"),
      ) as Record<string, Record<string, number>>;
      const queuedPaths = Object.values(pending).flatMap((repo) => Object.keys(repo));
      expect(queuedPaths).toContain(path.join("src", "a.ts"));
    });

    it("indexes the final state once, when flushed", () => {
      // Three rewrites in a row, as an agent iterating on one file.
      for (const body of ["one", "two", "three"]) {
        writeFileSync(target(), `export function alpha() {}\nexport function ${body}() {}\n`);
        runHookDebounced({ file_path: target() });
      }
      expect(exportsOf(path.join("src", "a.ts"))).not.toContain("three");

      runHookDebounced({}, ["--flush"]);
      const finalExports = exportsOf(path.join("src", "a.ts"));
      // Only the last version survives; the intermediate states were never
      // written, which is the entire point of waiting.
      expect(finalExports).toContain("three");
      expect(finalExports).not.toContain("one");
      expect(finalExports).not.toContain("two");
    });

    it("clears the queue after flushing", () => {
      writeFileSync(target(), "export function alpha() {}\nexport function settled() {}\n");
      runHookDebounced({ file_path: target() });
      runHookDebounced({}, ["--flush"]);
      const pending = JSON.parse(
        readFileSync(path.join(home, ".relay", "integrations", "discovery-pending.json"), "utf8"),
      ) as Record<string, Record<string, number>>;
      expect(Object.values(pending).flatMap((repo) => Object.keys(repo))).toEqual([]);
    });
  });
});

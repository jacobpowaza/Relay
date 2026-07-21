import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * End-to-end: desktop scan writes the index, the PostToolUse hook keeps it
 * current as an agent edits, and session-start surfaces the result to the next
 * agent. These three pieces live in different processes and only agree if they
 * share the same key normalization and entry shape.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const require = createRequire(import.meta.url);
const discovery = require(path.join(repoRoot, "apps/desktop/src/discovery.cjs")) as {
  discoverRepository: (root: string) => Promise<{ entries: unknown[]; discoveryCount: number }>;
};

const indexHook = path.join(repoRoot, "integrations/claude-code/hooks/discovery-index.mjs");
const sessionStart = path.join(repoRoot, "integrations/claude-code/hooks/session-start.mjs");

let workDir: string;
let home: string;
let workspaceFile: string;
let configFile: string;

function discoveryKey(p: string): string {
  return path.resolve(p).replace(/\/+$/, "").toLowerCase();
}

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: workDir, stdio: "ignore" });
}

function runSessionStart(): string {
  return execFileSync("node", [sessionStart], {
    input: JSON.stringify({ cwd: workDir }),
    env: { ...process.env, HOME: home },
    encoding: "utf8",
  });
}

beforeEach(async () => {
  // git rev-parse resolves symlinks, and on macOS tmpdir() is /var -> /private/var.
  // The hooks key off the git root, so the fixture must use the resolved path or
  // the config lookup misses and the board reads as unlinked.
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "relay-rt-")));
  home = path.join(workDir, "home");
  workspaceFile = path.join(home, "Library/Application Support/Relay/relay-data/workspace.json");
  configFile = path.join(home, ".relay/integrations/config.json");

  mkdirSync(path.join(workDir, "src"), { recursive: true });
  writeFileSync(path.join(workDir, "src", "auth.ts"), "export function login() {}\n");
  writeFileSync(path.join(workDir, "src", "util.ts"), "export function helper() {}\n");
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

  // Desktop-side scan, persisted exactly as the main process would.
  const index = await discovery.discoverRepository(workDir);
  mkdirSync(path.dirname(workspaceFile), { recursive: true });
  mkdirSync(path.dirname(configFile), { recursive: true });
  writeFileSync(workspaceFile, JSON.stringify({
    directories: [],
    boards: [{
      id: "board-1",
      name: "Roundtrip",
      repository: workDir,
      currentPhase: "Foundation",
      activeTasks: 0,
      blockers: 0,
      cards: [],
      phases: [],
      context: [],
      activity: [],
      decisions: [],
      columns: [],
    }],
    discoveries: { [discoveryKey(workDir)]: index },
  }, null, 2));
  writeFileSync(configFile, JSON.stringify({
    enabled: true,
    repositories: { [workDir]: { boardId: "board-1", enabled: true } },
  }, null, 2));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("discovery round trip across desktop, hook and session-start", () => {
  it("surfaces the index to the next session using the normalized key", () => {
    const output = runSessionStart();
    expect(output).toContain("Relay Discovery");
    expect(output).toContain("files indexed");
    // Proves the hook's key normalization matches the desktop's discoveryKey.
    expect(output).not.toContain("No discovery data");
  });

  it("reports a file edited outside the agent as changed", () => {
    writeFileSync(path.join(workDir, "src", "auth.ts"), "export function login() { return 1; }\nexport function logout() {}\n");
    const output = runSessionStart();
    // Regression: this pre-filtered on stored status, which is always
    // "current", so the changed list was permanently empty.
    expect(output).toContain("files changed since discovery");
    expect(output).toContain(path.join("src", "auth.ts"));
  });

  it("shows no changes once the hook has re-indexed the edited file", () => {
    const target = path.join(workDir, "src", "auth.ts");
    writeFileSync(target, "export function login() { return 1; }\nexport function logout() {}\n");
    // Debounce disabled: this covers the round trip, not the wait. With the
    // default quiet window the edit would still be queued at this point.
    execFileSync("node", [indexHook], {
      input: JSON.stringify({ cwd: workDir, tool_name: "Edit", tool_input: { file_path: target } }),
      env: { ...process.env, HOME: home, RELAY_DISCOVERY_QUIET_MS: "0" },
      encoding: "utf8",
    });

    const output = runSessionStart();
    expect(output).toContain("No files changed since last discovery.");

    const workspace = JSON.parse(readFileSync(workspaceFile, "utf8")) as {
      discoveries: Record<string, { entries: Array<{ filePath: string; importantExports: string[] }> }>;
    };
    const entry = workspace.discoveries[discoveryKey(workDir)]?.entries
      .find((e) => e.filePath === path.join("src", "auth.ts"));
    expect(entry?.importantExports).toEqual(expect.arrayContaining(["login", "logout"]));
  });

  it("tells the agent to consult the index before reading files", () => {
    const output = runSessionStart();
    expect(output).toContain("Check this index before opening a file");
  });
});

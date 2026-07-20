#!/usr/bin/env node
// ---------------------------------------------------------------------------
// test-standalone.mjs
// Validates that both Claude Code and Codex integrations work when deployed
// to a temporary directory OUTSIDE the Relay repository tree. This catches
// any repo-relative imports, missing files, or implicit dependencies that
// would break a standalone plugin installation.
//
// SAFETY: The test creates a private HOME directory under tmpRoot and passes
// it as $HOME to every child process. This prevents tests from touching the
// real ~/.relay config or ~/Library/Application Support/Relay workspace.
// ---------------------------------------------------------------------------
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";

const repoRoot = new URL("../../", import.meta.url).pathname;
const tmpRoot = mkdtempSync(join(realpathSync(tmpdir()), "relay-test-"));
const tmpHome = join(tmpRoot, "home");
const testEnv = { ...process.env, HOME: tmpHome };

const tmpClaude = join(tmpRoot, "claude-code");
const tmpCodex = join(tmpRoot, "codex");

const tmpRepo = join(tmpRoot, "test-repo"); // temporary git repo
const testDir = join(tmpRepo, "src");

let passed = 0;
let failed = 0;

const testPromises = [];

function test(name, fn) {
  const p = (async () => {
    try {
      const result = fn();
      if (result instanceof Promise) await result;
      passed += 1;
      console.log(`  PASS  ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`  FAIL  ${name}\n        ${e.message}`);
    }
  })();
  testPromises.push(p);
  return p;
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

/** Run node in a subprocess with testEnv (HOME -> tmpHome).
 *  Merges stdout + stderr so hooks that write to console.error
 *  (like checkpoint-hint) can be verified. Throws on nonzero exit. */
function runNode(args, opts = {}) {
  const result = spawnSync(process.execPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5000,
    encoding: "utf8",
    env: testEnv,
    ...opts,
  });
  if (result.error) throw result.error;
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const combined = stderr ? stdout + "\n" + stderr : stdout;
  if (result.status !== 0 && !opts.allowFailure) {
    throw new Error(`node exited ${result.status}:\n${combined.slice(0, 500)}`);
  }
  return combined;
}

/** Write a fixture file under tmpHome (child processes see this as $HOME) */
function writeFixture(relPath, data) {
  const abs = join(tmpHome, ...relPath.split("/"));
  mkdirSync(abs.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(abs, data, { mode: 0o600 });
}

// ---------------------------------------------------------------- setup

console.log("=== Standalone Integration Test ===\n");

async function main() {
  let keepDir = false;
  try {

mkdirSync(tmpHome, { recursive: true });
mkdirSync(testDir, { recursive: true });

// Copy integrations to temp
cpSync(join(repoRoot, "integrations", "claude-code"), tmpClaude, { recursive: true });
cpSync(join(repoRoot, "integrations", "codex"), tmpCodex, { recursive: true });

// Create a test git repo
execFileSync("git", ["init", tmpRepo], { stdio: "pipe", env: testEnv });
execFileSync("git", ["-C", tmpRepo, "config", "user.email", "test@test"], { stdio: "pipe", env: testEnv });
execFileSync("git", ["-C", tmpRepo, "config", "user.name", "Test"], { stdio: "pipe", env: testEnv });
writeFileSync(join(testDir, "index.ts"), "export const x = 1;\n");
execFileSync("git", ["-C", tmpRepo, "add", "-A"], { stdio: "pipe", env: testEnv });
execFileSync("git", ["-C", tmpRepo, "commit", "-m", "initial"], { stdio: "pipe", env: testEnv });

// Write test fixtures under tmpHome. Child processes inherit $HOME=tmpHome;
// os.homedir() respects $HOME via libuv, so fixtures appear at the paths
// the integration code expects (e.g. $HOME/.relay/integrations/config.json).
writeFixture(
  ".relay/integrations/config.json",
  JSON.stringify({
    enabled: true,
    localOnly: true,
    repositories: { [tmpRepo]: { boardId: "test-board-123", enabled: true } },
    uploadSourceSnippets: false,
    storeRawTranscripts: false,
    automaticBoardCreation: "ask",
    checkpointFrequency: "meaningful_steps",
  }, null, 2) + "\n"
);

writeFixture(
  "Library/Application Support/Relay/relay-data/workspace.json",
  JSON.stringify({
    boards: [{
      id: "test-board-123",
      name: "Test Board",
      currentPhase: "Development",
      activeTasks: 1,
      blockers: 0,
      progress: 25,
      cards: [{
        id: "card-1",
        title: "Implement login",
        columnId: "progress",
        priority: "high",
        progress: 50,
        phaseId: "phase-1",
        updatedAt: new Date().toISOString(),
      }],
      phases: [{
        id: "phase-1",
        name: "Development",
        objective: "Build core features",
        progress: 25,
        status: "in_progress",
      }],
      directories: [],
      activity: [],
      context: [],
      decisions: [],
    }],
    directories: [{ id: "dir-1", name: "Test", repo: tmpRepo, boardIds: ["test-board-123"] }],
    settings: {},
    tags: [],
  }, null, 2) + "\n"
);

// ---------------------------------------------------------- 1. file integrity

console.log("1. Plugin file integrity");
test("claude-code has vendored core/index.js", () => {
  assert(existsSync(join(tmpClaude, "core", "index.js")), "missing claude core/index.js");
});
test("claude-code has plugin manifest", () => {
  assert(existsSync(join(tmpClaude, ".claude-plugin", "plugin.json")), "missing .claude-plugin/plugin.json");
});
test("claude-code has hook scripts", () => {
  assert(existsSync(join(tmpClaude, "hooks", "session-start.mjs")), "missing session-start.mjs");
  assert(existsSync(join(tmpClaude, "hooks", "session-end.mjs")), "missing session-end.mjs");
  assert(existsSync(join(tmpClaude, "hooks", "checkpoint-hint.mjs")), "missing checkpoint-hint.mjs");
});
test("claude-code has relay-progress.mjs", () => {
  assert(existsSync(join(tmpClaude, "scripts", "relay-progress.mjs")), "missing relay-progress.mjs");
});
test("claude-code has statusline.mjs", () => {
  assert(existsSync(join(tmpClaude, "scripts", "statusline.mjs")), "missing statusline.mjs");
});
test("claude-code has install-statusline.mjs", () => {
  assert(existsSync(join(tmpClaude, "scripts", "install-statusline.mjs")), "missing install-statusline.mjs");
});
test("codex has vendored core/index.js", () => {
  assert(existsSync(join(tmpCodex, "core", "index.js")), "missing codex core/index.js");
});
test("codex has MCP server", () => {
  assert(existsSync(join(tmpCodex, "mcp", "relay-mcp.mjs")), "missing relay-mcp.mjs");
});
test("codex has MCP config", () => {
  assert(existsSync(join(tmpCodex, ".mcp.json")), "missing .mcp.json");
});
test("codex has slash-command definition", () => {
  assert(existsSync(join(tmpCodex, "commands", "relay.md")), "missing commands/relay.md");
});

// ------------------------------------------------- 2. Claude Code hook tests

console.log("\n2. Claude Code hooks (standalone)");

test("session-start.mjs loads without repo-relative imports", () => {
  const src = runNode(["-e",
    `import("./session-start.mjs").then(m => console.log("loaded")).catch(e => console.error(e.message))`
  ], { cwd: join(tmpClaude, "hooks"), input: JSON.stringify({ cwd: tmpRepo }) });
  assert(src.includes("loaded") || src.includes("[RELAY]"), `unexpected output: ${src.slice(0, 200)}`);
});

test("session-start.mjs prints [RELAY] for linked repo", () => {
  const result = runNode([join(tmpClaude, "hooks", "session-start.mjs")], {
    cwd: tmpRepo, input: JSON.stringify({ cwd: tmpRepo }),
  });
  assert(result.includes("[RELAY]"), `expected [RELAY] in output: ${result.slice(0, 300)}`);
});

test("session-start.mjs prints [RELAY] Active for linked board", () => {
  const result = runNode([join(tmpClaude, "hooks", "session-start.mjs")], {
    cwd: tmpRepo, input: JSON.stringify({ cwd: tmpRepo }),
  });
  assert(result.includes("[RELAY] Active"), `expected [RELAY] Active: ${result.slice(0, 300)}`);
  assert(result.includes("Test Board"), `expected board name in output: ${result.slice(0, 300)}`);
});

test("checkpoint-hint.mjs writes marker and prints reminder to stderr", () => {
  const result = runNode([join(tmpClaude, "hooks", "checkpoint-hint.mjs")], { cwd: tmpRepo });
  assert(result.includes("Relay reminder"), `expected reminder text, got: ${result.slice(0, 300)}`);

  // Verify the marker file was written under tmpHome (not real home)
  const markerPath = join(tmpHome, ".relay/integrations/last-checkpoint-hint");
  assert(existsSync(markerPath), "checkpoint hint marker not created");
  const ts = Number(readFileSync(markerPath, "utf8"));
  assert(ts > 0, `marker should be a timestamp, got: ${ts}`);
});

test("session-end.mjs imports vendored core and runs without repo-relative path error", () => {
  const result = runNode([join(tmpClaude, "hooks", "session-end.mjs")], {
    cwd: tmpRepo, input: JSON.stringify({ summary: "Fixed login bug", changedFiles: ["src/auth.ts"] }),
  });
  assert(!result.includes("Error: Cannot find module"), `module resolution error: ${result.slice(0, 300)}`);
  assert(!result.includes("import("), `import error: ${result.slice(0, 300)}`);
});

test("relay-progress.mjs basic status command works standalone", () => {
  const result = runNode([join(tmpClaude, "scripts", "relay-progress.mjs"), "status", "--cwd", tmpRepo], {
    cwd: tmpRepo,
  });
  assert(result.includes("boardId") || result.includes("active") || result.length > 0,
    `unexpected status output: ${result.slice(0, 300)}`);
});

// ------------------------------------------------- 2b. Status line tests

console.log("\n2b. Status line (standalone)");

test("statusline.mjs prints [RELAY] Inactive for non-linked path", () => {
  // tmpClaude is a non-git directory not in the config's repositories
  const result = runNode([join(tmpClaude, "scripts", "statusline.mjs"), "--cwd", tmpClaude], {
    cwd: tmpClaude,
  });
  assert(result.includes("[RELAY] Inactive"), `expected [RELAY] Inactive: ${result.slice(0, 100)}`);
});

test("statusline.mjs prints [RELAY] Active for linked repo with board", () => {
  const result = runNode([join(tmpClaude, "scripts", "statusline.mjs"), "--cwd", tmpRepo], {
    cwd: tmpRepo,
  });
  assert(result.includes("[RELAY] Active"), `expected [RELAY] Active: ${result.slice(0, 100)}`);
  assert(result.includes("Implement login"),
    `expected card title in output: ${result.slice(0, 100)}`);
});

test("statusline.mjs prints [RELAY] Disabled when config says so", () => {
  const backupPath = join(tmpHome, ".relay/integrations/config.json.bak");
  const realConfig = readFileSync(join(tmpHome, ".relay/integrations/config.json"), "utf8");
  writeFixture(".relay/integrations/config.json", JSON.stringify({
    enabled: false, repositories: {},
  }) + "\n");
  const result = runNode([join(tmpClaude, "scripts", "statusline.mjs"), "--cwd", tmpRepo], {
    cwd: tmpRepo,
  });
  // Restore before assert so cleanup always happens
  writeFixture(".relay/integrations/config.json", realConfig);
  assert(result.includes("[RELAY] Disabled"), `expected [RELAY] Disabled: ${result.slice(0, 100)}`);
});

test("statusline.mjs reads cwd from stdin JSON", () => {
  const stdInput = JSON.stringify({ cwd: tmpRepo });
  const result = runNode([join(tmpClaude, "scripts", "statusline.mjs")], {
    cwd: tmpClaude, // not the repo — should fail without stdin
    input: stdInput,
  });
  assert(result.includes("[RELAY] Active"), `expected [RELAY] Active from stdin: ${result.slice(0, 100)}`);
});

test("statusline.mjs prints [RELAY] Inactive for non-git directory via stdin", () => {
  const stdInput = JSON.stringify({ cwd: tmpClaude });
  const result = runNode([join(tmpClaude, "scripts", "statusline.mjs")], {
    cwd: tmpClaude,
    input: stdInput,
  });
  assert(result.includes("[RELAY] Inactive"), `expected [RELAY] Inactive for non-git: ${result.slice(0, 100)}`);
});

test("statusline.mjs prints exactly one line", () => {
  const result = runNode([join(tmpClaude, "scripts", "statusline.mjs"), "--cwd", tmpRepo], {
    cwd: tmpRepo,
  });
  const lines = result.trim().split("\n").filter(Boolean);
  assert(lines.length === 1, `expected 1 line, got ${lines.length}: ${result.slice(0, 100)}`);
});

// ------------------------------------------------- 2c. Installer tests

console.log("\n2c. Installer (standalone)");

function readSettings() {
  return JSON.parse(readFileSync(join(tmpHome, ".claude", "settings.json"), "utf8"));
}

function runInstaller(args = []) {
  return runNode([join(tmpClaude, "scripts", "install-statusline.mjs"), ...args], {
    cwd: tmpRepo,
    env: { ...testEnv, HOME: tmpHome },
  });
}

test("installer: registers relay when no existing statusLine", () => {
  // Official statusLine schema at https://docs.anthropic.com/en/docs/claude-code/settings#statusline-command:
  //   "The object's optional padding, refreshInterval, and hideVimModeIndicator fields
  //    control spacing, periodic re-runs, and whether ..."
  // And at https://docs.anthropic.com/en/docs/claude-code/statusline:
  //   "The optional refreshInterval field re-runs your command every N seconds"
  //   "The optional padding field adds extra horizontal spacing (in characters)"
  writeFixture(".claude/settings.json", JSON.stringify({}) + "\n");
  const result = runInstaller();
  assert(result.includes("No existing statusLine"), `expected fresh install msg: ${result.slice(0, 200)}`);
  const s = readSettings();
  assert(s.statusLine?.type === "command", `expected type=command`);
  assert(s.statusLine?.command.includes("statusline.mjs"), `expected relay script: ${s.statusLine?.command}`);
  assert(typeof s.statusLine?.refreshInterval === "number", `expected numeric refreshInterval`);
  assert(typeof s.statusLine?.padding === "number", `expected numeric padding`);
});

test("installer: composes with existing caveman status line", () => {
  writeFixture(".claude/settings.json", JSON.stringify({
    statusLine: { type: "command", command: `bash "${tmpHome}/.claude/hooks/caveman-statusline.sh"` }
  }) + "\n");
  const result = runInstaller();
  assert(result.includes("Existing statusLine detected"), `expected compose msg: ${result.slice(0, 200)}`);
  const s = readSettings();
  assert(s.statusLine?.command.includes("relay-composed.sh"), `expected wrapper path: ${s.statusLine?.command}`);
  // Verify wrapper was created
  const wrapperPath = join(tmpHome, ".claude", "hooks", "relay-composed.sh");
  assert(existsSync(wrapperPath), "wrapper script should exist");
  const wrapper = readFileSync(wrapperPath, "utf8");
  assert(wrapper.includes("caveman-statusline.sh"), `wrapper should embed existing cmd: ${wrapper.slice(0, 200)}`);
  assert(!wrapper.includes("eval"), "wrapper should NOT use eval");
});

test("installer: composes with arbitrary existing status line", () => {
  writeFixture(".claude/settings.json", JSON.stringify({
    statusLine: { type: "command", command: `node "/some/random/status.js" --flag value` }
  }) + "\n");
  const result = runInstaller();
  assert(result.includes("Existing statusLine detected"), `expected compose msg: ${result.slice(0, 200)}`);
  const s = readSettings();
  assert(s.statusLine?.command.includes("relay-composed.sh"), `expected wrapper path`);
  const wrapper = readFileSync(join(tmpHome, ".claude", "hooks", "relay-composed.sh"), "utf8");
  assert(wrapper.includes("random/status.js"), `wrapper should embed arbitrary cmd: ${wrapper.slice(0, 200)}`);
  assert(!wrapper.includes("eval"), "wrapper should NOT use eval");
});

test("installer: no-op when relay already registered", () => {
  const existingCmd = `node "${join(tmpClaude, "scripts", "statusline.mjs")}"`;
  writeFixture(".claude/settings.json", JSON.stringify({
    statusLine: { type: "command", command: existingCmd, refreshInterval: 5 }
  }) + "\n");
  const result = runInstaller();
  assert(result.includes("already registered"), `expected no-op msg: ${result.slice(0, 200)}`);
});

test("installer: creates backup before overwriting", () => {
  writeFixture(".claude/settings.json", JSON.stringify({ someKey: "original" }) + "\n");
  const result = runInstaller();
  const bakFiles = readdirSync(tmpHome + "/.claude").filter((f) => f.startsWith("settings.json.bak"));
  assert(bakFiles.length >= 1, `expected backup file, found: ${JSON.stringify(bakFiles)}`);
});

test("installer: malformed settings JSON produces graceful error", () => {
  writeFixture(".claude/settings.json", "{ invalid json here ");
  try {
    runInstaller();
    assert(false, "should have thrown on malformed JSON");
  } catch (e) {
    assert(e.message.includes("Could not parse") || e.message.includes("invalid"),
      `expected parse error msg: ${e.message.slice(0, 200)}`);
  }
});

test("installer: handles path with spaces in existing command", () => {
  const spaceDir = join(tmpRoot, "my plugins");
  mkdirSync(join(spaceDir, "hooks"), { recursive: true });
  const dummyScript = join(spaceDir, "hooks", "status.sh");
  writeFileSync(dummyScript, "#!/usr/bin/env bash\necho Hello", { mode: 0o755 });
  writeFixture(".claude/settings.json", JSON.stringify({
    statusLine: { type: "command", command: `bash "${dummyScript}"` }
  }) + "\n");
  const result = runInstaller();
  assert(result.includes("Existing statusLine detected"), `expected compose: ${result.slice(0, 200)}`);
  const wrapper = readFileSync(join(tmpHome, ".claude", "hooks", "relay-composed.sh"), "utf8");
  assert(wrapper.includes("my plugins"), `wrapper should preserve space path: ${wrapper.slice(0, 200)}`);
});

test("installer: handles existing command with single quotes", () => {
  writeFixture(".claude/settings.json", JSON.stringify({
    statusLine: { type: "command", command: `node -e "console.log('hello world')"` }
  }) + "\n");
  const result = runInstaller();
  assert(result.includes("Existing statusLine detected"), `expected compose: ${result.slice(0, 200)}`);
  const wrapper = readFileSync(join(tmpHome, ".claude", "hooks", "relay-composed.sh"), "utf8");
  assert(wrapper.includes("console.log"), `wrapper should embed single-quoted cmd: ${wrapper.slice(0, 200)}`);
});

test("installer: missing config file (no settings.json) creates it with relay", () => {
  rmSync(join(tmpHome, ".claude", "settings.json"), { force: true });
  const result = runInstaller();
  assert(result.includes("No existing statusLine"), `expected fresh install: ${result.slice(0, 200)}`);
  assert(existsSync(join(tmpHome, ".claude", "settings.json")), "settings.json should be created");
  const s = readSettings();
  assert(s.statusLine?.command.includes("statusline.mjs"), `relay should be registered`);
});

test("installer: --force overwrites existing status line without composing", () => {
  writeFixture(".claude/settings.json", JSON.stringify({
    statusLine: { type: "command", command: `node "/other/script.js"` }
  }) + "\n");
  const result = runInstaller(["--force"]);
  assert(result.includes("--force: overwriting"), `expected force msg: ${result.slice(0, 200)}`);
  const s = readSettings();
  assert(s.statusLine?.command.includes("statusline.mjs"), `relay should be direct: ${s.statusLine?.command}`);
  assert(!s.statusLine?.command.includes("relay-composed.sh"), "should NOT create wrapper with --force");
});

// ------------------------------------------------- 2d. Sync-safety tests
// Confirm that sync-plugins does not modify global settings without
// an explicit --install-statusline flag.

console.log("\n2d. Plugin sync safety (standalone)");

test("sync-plugins source requires --install-statusline flag to call installer", () => {
  const syncPath = join(repoRoot, "integrations/scripts/sync-plugins.mjs");
  const src = readFileSync(syncPath, "utf8");

  // The flag check must appear in the source
  const flagIndex = src.indexOf('"--install-statusline"');
  assert(flagIndex >= 0, "sync-plugins must reference --install-statusline flag");

  // The installer reference must be inside the flag's if-block, not before it
  const ifIndex = src.lastIndexOf("if (", flagIndex);
  const installerRef = src.indexOf("install-statusline", flagIndex);
  assert(installerRef > flagIndex, "installer must be called inside flag check block, not before");
  assert(installerRef - flagIndex < 120,
    `installer ref too far from flag (offset=${installerRef - flagIndex})`);
});

test("sync-plugins does not modify settings when --install-statusline is absent (marketplace mock)", () => {
  // Set up a minimal marketplace structure in the sandbox so the path
  // resolution works, even though the build step will likely fail.
  const marketDir = join(tmpHome, ".claude/plugins/marketplaces/relay-local");
  mkdirSync(join(marketDir, "scripts"), { recursive: true });
  mkdirSync(join(marketDir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(marketDir, "hooks"), { recursive: true });
  mkdirSync(join(marketDir, "skills", "progress"), { recursive: true });
  mkdirSync(join(marketDir, "core"), { recursive: true });

  // Minimal files so the deploy+validate steps don't choke.
  // The installer is the actual one — we need it to exist at the path
  // sync-plugins checks.
  cpSync(join(tmpClaude, "scripts", "install-statusline.mjs"), join(marketDir, "scripts", "install-statusline.mjs"));
  cpSync(join(tmpClaude, "scripts", "statusline.mjs"), join(marketDir, "scripts", "statusline.mjs"));
  // The sync script validates these exist for the marketplace target
  writeFileSync(join(marketDir, ".claude-plugin/plugin.json"), JSON.stringify({}));
  writeFileSync(join(marketDir, "hooks/session-start.mjs"), "// mock\n");
  writeFileSync(join(marketDir, "scripts/relay-progress.mjs"), "// mock\n");
  writeFileSync(join(marketDir, "skills/progress/SKILL.md"), "# mock\n");
  writeFileSync(join(marketDir, "core/index.js"), "// mock\n");

  writeFixture(".claude/settings.json", JSON.stringify({ originalKey: "should-survive" }) + "\n");

  // Run sync-plugins without --install-statusline in the test sandbox
  // The build + deploy steps may fail in the sandbox (different node env),
  // but step 5 is all we care about — it must NOT fire.
  try {
    runNode([join(repoRoot, "integrations/scripts/sync-plugins.mjs")], {
      cwd: repoRoot,
      env: testEnv,
      timeout: 120_000,
    });
  } catch (e) {
    // Accept failure from build/deploy; what matters is settings.json
  }

  // Verify settings.json was NOT modified by the installer
  const s = JSON.parse(readFileSync(join(tmpHome, ".claude/settings.json"), "utf8"));
  assert(s.originalKey === "should-survive", "original setting must be preserved");
  assert(s.statusLine === undefined, "statusLine must NOT be added without --install-statusline flag");
});

// ---------------------------------------------------- 3. Codex hook tests

console.log("\n3. Codex hooks (standalone)");

test("codex session-start.mjs works standalone", () => {
  const result = runNode([join(tmpCodex, "hooks", "session-start.mjs")], {
    cwd: tmpRepo, input: JSON.stringify({ cwd: tmpRepo }),
  });
  assert(result.includes("[RELAY]"), `expected [RELAY] in output: ${result.slice(0, 300)}`);
});

test("codex session-end.mjs runs without repo-relative import error", () => {
  const result = runNode([join(tmpCodex, "hooks", "session-end.mjs")], {
    cwd: tmpRepo, input: JSON.stringify({ summary: "Completed auth", changedFiles: ["src/auth.ts"] }),
  });
  assert(!result.includes("Error: Cannot find module"), `module resolution error: ${result.slice(0, 300)}`);
});

test("codex checkpoint-hint.mjs writes marker and prints reminder", () => {
  // Pass "pre-compact" to force the hint to fire regardless of the marker
  // timestamp (the claude-code test already wrote one moments ago).
  const result = runNode([join(tmpCodex, "hooks", "checkpoint-hint.mjs"), "pre-compact"], { cwd: tmpRepo });
  assert(result.includes("Relay reminder"), `expected reminder text, got: ${result.slice(0, 300)}`);

  const markerPath = join(tmpHome, ".relay/integrations/last-checkpoint-hint");
  assert(existsSync(markerPath), "checkpoint hint marker not created");
  const ts = Number(readFileSync(markerPath, "utf8"));
  assert(ts > 0, `marker should be a timestamp, got: ${ts}`);
});

test("codex MCP server starts and lists tools", async () => {
  const mcpInput = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
  }) + "\n" + JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  }) + "\n";

  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(tmpCodex, "mcp", "relay-mcp.mjs")], {
      cwd: tmpRepo,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
      env: testEnv,
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk.toString()));
    child.stderr.on("data", () => {});
    let done = false;
    child.stdout.on("end", () => { if (!done) { done = true; resolve(chunks.join("")); } });
    child.on("error", reject);
    child.on("close", () => { if (!done) { done = true; resolve(chunks.join("")); } });
    child.stdin.write(mcpInput);
    setTimeout(() => { if (!done) { done = true; child.kill(); resolve(chunks.join("")); } }, 3000);
  });

  function parseMcpMessages(raw) {
    const msgs = [];
    const headerRe = /Content-Length:\s*(\d+)\r?\n\r?\n([\s\S]*?)(?=Content-Length:|$)/g;
    let match;
    while ((match = headerRe.exec(raw)) !== null) {
      const body = match[2].trim();
      if (body) try { msgs.push(JSON.parse(body)); } catch {}
    }
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (t.startsWith("{")) try { msgs.push(JSON.parse(t)); } catch {}
    }
    return msgs;
  }

  const responses = parseMcpMessages(output);

  const initResponse = responses.find((r) => r.id === 1);
  assert(initResponse !== undefined, `no initialize response. Output: ${output.slice(0, 500)}`);
  assert(initResponse.result !== undefined, `initialize failed: ${JSON.stringify(initResponse)}`);

  const toolsResponse = responses.find((r) => r.id === 2);
  assert(toolsResponse !== undefined, `no tools/list response. Output: ${output.slice(0, 500)}`);
  assert(toolsResponse.result?.tools !== undefined, `tools/list missing tools array: ${JSON.stringify(toolsResponse)}`);

  const toolNames = toolsResponse.result.tools.map((t) => t.name);
  assert(toolNames.includes("relay_status"), `expected relay_status in ${JSON.stringify(toolNames)}`);
  assert(toolNames.includes("relay_resume"), `expected relay_resume in ${JSON.stringify(toolNames)}`);
});

test("codex relay-progress.mjs status works standalone", () => {
  const result = runNode([join(tmpCodex, "scripts", "relay-progress.mjs"), "status", "--cwd", tmpRepo], {
    cwd: tmpRepo,
  });
  assert(result.includes("boardId") || result.includes("active") || result.length > 0,
    `unexpected output: ${result.slice(0, 300)}`);
});

// ----------------------------------------------- 4. Repo-relative import audit

console.log("\n4. Repo-relative import audit");

for (const [label, dir] of [["claude-code", tmpClaude], ["codex", tmpCodex]]) {
  test(`${label} has no references to ../../core/dist/src/`, () => {
    let found = "";
    try {
      found = execFileSync("grep", ["-rn", `from.*\\.\\./\\.\\./core/dist/src/`, dir, "--include=*.mjs"], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5000,
        encoding: "utf8",
        env: testEnv,
      });
    } catch (e) {
      // grep exits 1 when no match — that's success
      if (e.status !== 1) throw e;
    }
    assert(found.trim() === "", `found repo-relative imports:\n${found}`);
  });
}

// --------------------------------------------- 5. Relay-progress CLI tests

console.log("\n5. CLI integration tests");

test("relay-progress status returns valid JSON", () => {
  const result = runNode([join(tmpClaude, "scripts", "relay-progress.mjs"), "status", "--cwd", tmpRepo], {
    cwd: tmpRepo,
  });
  const parsed = JSON.parse(result);
  assert(parsed !== null, "status output is not valid JSON");
});

test("relay-progress resume works with linked board", () => {
  const result = runNode([join(tmpClaude, "scripts", "relay-progress.mjs"), "resume", "--cwd", tmpRepo], {
    cwd: tmpRepo,
  });
  assert(result.includes("[RELAY] Active"), `resume missing [RELAY] Active: ${result.slice(0, 300)}`);
  assert(result.includes("Test Board"), `resume missing board name: ${result.slice(0, 300)}`);
});

// ---------------------------------------------------------------- cleanup

await Promise.all(testPromises);
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

if (failed > 0) {
  keepDir = true;
  console.log(`\nTemp test directories preserved at:\n  ${tmpRoot}`);
  return "KEEP";
}

} finally {
  if (!keepDir) rmSync(tmpRoot, { recursive: true, force: true });
}
}

const result = await main().catch((e) => {
  console.error("Setup failed:", e.message);
  process.exit(1);
});
if (result === "KEEP") process.exit(1);

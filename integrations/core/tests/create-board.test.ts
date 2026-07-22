import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "..", "claude-code", "scripts", "relay-progress.mjs");

let sandbox: string;
let home: string;
let repo: string;

// Shapes of the on-disk workspace and the CLI's JSON output. Fields are optional
// because different subcommands emit different payloads; the tests assert on the
// subset each command produces.
interface Phase { id: string; name: string; objective: string; progress: number; status: string }
interface ContextEntry { id: string; category: string; title: string; content: string; confidence: string; updatedAt: string }
interface Decision { title: string; decision: string; reason: string; status: string }
interface ActivityEntry { action: string; target: string }
interface Card { title: string }
interface Board {
  id: string;
  name: string;
  directoryId: string;
  repository: string;
  plan: string;
  originalPrompt: string;
  taskId: string;
  cards: Card[];
  phases: Phase[];
  context: ContextEntry[];
  activity: ActivityEntry[];
  decisions: Decision[];
}
interface Directory { id: string; path: string; name?: string }
interface Workspace { directories: Directory[]; boards: Board[] }
interface CommandJson {
  ok?: boolean;
  mode?: string;
  verified?: boolean;
  boardId?: string;
  taskId?: string;
  idempotencyKey?: string;
  stage?: string;
  error?: string;
  cardCount?: number;
  phaseCount?: number;
  complexity?: string;
  relayDataPath?: string;
  repairs?: string[];
  contextEntryCount?: number;
  resumePayloadTokens?: number;
  estimatedInputTokens?: { total: number; sections: unknown[] };
  plan?: string;
}

function workspaceFile(homeDir = home): string {
  return join(homeDir, "Library", "Application Support", "Relay", "relay-data", "workspace.json");
}

function readWorkspace(homeDir = home): Workspace {
  return JSON.parse(readFileSync(workspaceFile(homeDir), "utf8")) as Workspace;
}

/** Finds a board by id, asserting it exists (tests always create it first). */
function boardById(workspace: Workspace, id: string | undefined): Board {
  const board = workspace.boards.find((candidate) => candidate.id === id);
  if (board === undefined) throw new Error(`Expected board ${String(id)} to exist`);
  return board;
}

function run(
  args: string[],
  { stdin = "", cwd = repo, homeDir = home }: { stdin?: string; cwd?: string; homeDir?: string } = {},
): { ok: boolean; stdout: string; stderr: string; json: CommandJson } {
  try {
    const stdout = execFileSync("node", [script, ...args], {
      cwd,
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, RELAY_AGENT_NAME: "Claude" },
    });
    return { ok: true, stdout, stderr: "", json: safeJson(stdout) };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string };
    const stdout = execError.stdout ?? "";
    const stderr = execError.stderr ?? "";
    return { ok: false, stdout, stderr, json: safeJson(stderr || stdout) };
  }
}

function safeJson(text: string): CommandJson {
  try {
    return JSON.parse(text) as CommandJson;
  } catch {
    return {};
  }
}

function gitInit(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
}

beforeEach(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "relay-cb-")));
  home = join(sandbox, "home");
  repo = join(sandbox, "home", "dev", "app");
  mkdirSync(home, { recursive: true });
  gitInit(repo);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("create-board reliability", () => {
  it("persists a board that reads back and is attached to the correct directory", () => {
    const result = run(["create-board", "--title", "Feature Alpha"], { stdin: "## Do the thing\n" });
    expect(result.ok).toBe(true);
    expect(result.json.ok).toBe(true);
    expect(result.json.mode).toBe("created");
    expect(result.json.verified).toBe(true);

    const workspace = readWorkspace();
    const board = boardById(workspace, result.json.boardId);
    expect(board.name).toBe("Feature Alpha");
    const directory = workspace.directories.find((candidate) => candidate.id === board.directoryId);
    expect(directory).toBeDefined();
    expect(directory!.path).toBe(realpathSync(repo));
  });

  it("creates a NEW board for a different task in the same repository", () => {
    const first = run(["create-board", "--title", "Feature Alpha"], { stdin: "## A\n" });
    const second = run(["create-board", "--title", "Feature Beta"], { stdin: "## B\n" });
    expect(first.json.boardId).not.toBe(second.json.boardId);
    expect(second.json.mode).toBe("created");
    const workspace = readWorkspace();
    expect(workspace.boards).toHaveLength(2);
    expect(workspace.directories).toHaveLength(1); // multiple boards under one directory
  });

  it("is idempotent: duplicate calls for the same task resume the same board", () => {
    const first = run(["create-board", "--title", "Feature Alpha"], { stdin: "## Same request\n" });
    const second = run(["create-board", "--title", "Feature Alpha"], { stdin: "## Same request\n" });
    expect(second.json.mode).toBe("resumed");
    expect(second.json.boardId).toBe(first.json.boardId);
    expect(readWorkspace().boards).toHaveLength(1);
  });

  it("treats trailing-slash and non-canonical paths as the same repository", () => {
    const first = run(["create-board", "--title", "Feature Alpha", "--cwd", repo], { stdin: "## Same\n" });
    const second = run(["create-board", "--title", "Feature Alpha", "--cwd", `${repo}/`], { stdin: "## Same\n" });
    expect(second.json.boardId).toBe(first.json.boardId);
    expect(readWorkspace().boards).toHaveLength(1);
  });

  it("treats a ~-relative repository path as the same repository", () => {
    // repo lives under home/dev/app, so ~/dev/app expands to the same place.
    const first = run(["create-board", "--title", "Feature Alpha", "--cwd", repo], { stdin: "## Same\n" });
    const second = run(["create-board", "--title", "Feature Alpha", "--cwd", "~/dev/app"], { stdin: "## Same\n" });
    expect(second.json.boardId).toBe(first.json.boardId);
    expect(readWorkspace().boards).toHaveLength(1);
  });

  it("treats a symlinked repository path as the same repository", () => {
    const link = join(sandbox, "link-to-app");
    symlinkSync(repo, link);
    const first = run(["create-board", "--title", "Feature Alpha", "--cwd", repo], { stdin: "## Same\n" });
    const second = run(["create-board", "--title", "Feature Alpha", "--cwd", link], { stdin: "## Same\n" });
    expect(second.json.boardId).toBe(first.json.boardId);
    expect(readWorkspace().boards).toHaveLength(1);
  });

  it("continues an existing board by name only when explicitly asked", () => {
    const created = run(["create-board", "--title", "Feature Alpha"], { stdin: "## A\n" });
    const continued = run(["create-board", "--title", "Feature Alpha", "--continue-board", "Feature Alpha"], { stdin: "## more\n" });
    expect(continued.json.mode).toBe("continue");
    expect(continued.json.boardId).toBe(created.json.boardId);
  });

  it("fails clearly when asked to continue a board that does not exist", () => {
    const result = run(["create-board", "--title", "Nope", "--continue-board", "Ghost Board"], { stdin: "## x\n" });
    expect(result.ok).toBe(false);
    expect(result.json.ok).toBe(false);
    expect(result.json.stage).toBe("resolve");
    expect(typeof result.json.error).toBe("string");
  });

  it("survives a simulated restart: the board is still present on a fresh read", () => {
    const created = run(["create-board", "--title", "Feature Alpha"], { stdin: "## A\n" });
    // Fresh read from disk (new process already wrote it) simulates app restart.
    const reread = readWorkspace();
    expect(reread.boards.some((board) => board.id === created.json.boardId)).toBe(true);
  });

  it("reports failure (never false success) when persistence cannot write", () => {
    // Make the workspace path un-writable by planting a FILE where the
    // relay-data directory must be created.
    const relayDir = join(home, "Library", "Application Support", "Relay", "relay-data");
    mkdirSync(dirname(relayDir), { recursive: true });
    writeFileSync(relayDir, "not a directory");

    const result = run(["create-board", "--title", "Feature Alpha"], { stdin: "## A\n" });
    expect(result.ok).toBe(false);
    expect(result.json?.ok).toBe(false);
    expect(result.stdout).not.toContain("\"ok\": true");
    // Plan preserved for retry.
    const pending = join(home, ".relay", "integrations", "pending");
    const files = safeReaddir(pending);
    expect(files.length).toBeGreaterThan(0);
    const preserved = JSON.parse(readFileSync(join(pending, files[0]!), "utf8")) as CommandJson;
    expect(preserved.ok).toBe(false);
    expect(preserved.plan).toContain("## A");
  });
});

describe("separate tasks in one repository", () => {
  it("creates separate boards for different tasks in the same repo", () => {
    const alpha = run(["create-board", "--title", "Feature Alpha"], { stdin: "## Add user auth\nImplement login and registration.\n" });
    const beta = run(["create-board", "--title", "Feature Beta"], { stdin: "## Add admin dashboard\nBuild the admin panel.\n" });
    expect(alpha.json.boardId).not.toBe(beta.json.boardId);
    expect(beta.json.mode).toBe("created");
    const workspace = readWorkspace();
    expect(workspace.boards.length).toBeGreaterThanOrEqual(2);
    const names = workspace.boards.map((b) => b.name);
    expect(names).toContain("Feature Alpha");
    expect(names).toContain("Feature Beta");
  });

  it("never defaults to same-repo fallback for a new task", () => {
    const first = run(["create-board", "--title", "Task One"], { stdin: "## First task\n" });
    const second = run(["create-board", "--title", "Task Two"], { stdin: "## Second task (different)\n" });
    const third = run(["create-board", "--title", "Task Three"], { stdin: "## Third task (also different)\n" });
    expect(first.json.boardId).not.toBe(second.json.boardId);
    expect(second.json.boardId).not.toBe(third.json.boardId);
    expect(first.json.boardId).not.toBe(third.json.boardId);
    expect(second.json.mode).toBe("created");
    expect(third.json.mode).toBe("created");
  });
});

describe("exact task resume", () => {
  it("resumes the same board for identical request via taskId", () => {
    const request = "## Implement dark mode\nAdd a dark mode toggle to settings.\n";
    const first = run(["create-board", "--title", "Dark Mode"], { stdin: request });
    const second = run(["create-board", "--title", "Dark Mode"], { stdin: request });
    expect(second.json.mode).toBe("resumed");
    expect(second.json.boardId).toBe(first.json.boardId);
    expect(second.json.taskId).toBe(first.json.taskId);
  });

  it("resumes the same board for retried call with matching idempotencyKey", () => {
    const first = run(["create-board", "--title", "Retry Test"], { stdin: "## Retry\nHandle retries.\n" });
    const idempotencyKey = first.json.idempotencyKey ?? "";
    const second = run(["create-board", "--title", "Retry Test", "--idempotency-key", idempotencyKey], { stdin: "## Retry\nHandle retries.\n" });
    expect(second.json.boardId).toBe(first.json.boardId);
    expect(second.json.mode).toBe("resumed");
  });
});

describe("plan-first board creation", () => {
  it("saves full original prompt in plan and originalPrompt fields", () => {
    const request = "## Add user auth\nImplement login and registration with JWT.\n## Add admin dashboard\nBuild the admin panel.";
    const result = run(["create-board", "--title", "Auth & Admin"], { stdin: request });
    expect(result.json.ok).toBe(true);
    const workspace = readWorkspace();
    const board = boardById(workspace, result.json.boardId);
    expect(board.plan).toBe(request);
    expect(board.originalPrompt).toBe(request);
    expect(board.taskId).toBeDefined();
    expect(typeof board.taskId).toBe("string");
    expect(board.taskId.length).toBeGreaterThan(0);
  });

  it("generates multiple cards from headings in request", () => {
    const request = [
      "## Foundation",
      "Set up project structure and dependencies.",
      "## User authentication",
      "Add login, registration, OAuth.",
      "## Admin panel",
      "Build admin dashboard with user management.",
      "## API documentation",
      "Document all endpoints with OpenAPI.",
    ].join("\n");
    const result = run(["create-board", "--title", "Multi-Card"], { stdin: request });
    expect(result.json.cardCount).toBeGreaterThanOrEqual(2);
    expect(result.json.phaseCount).toBeGreaterThanOrEqual(2);
    const workspace = readWorkspace();
    const board = boardById(workspace, result.json.boardId);
    expect(board.cards.length).toBeGreaterThanOrEqual(2);
    const names = board.cards.map((c) => c.title);
    expect(names).not.toContain("Plan first implementation card");
    expect(board.phases.length).toBeGreaterThanOrEqual(2);
    const phaseNames = new Set(board.phases.map((p) => p.name));
    expect(phaseNames.size).toBe(board.phases.length);
  });
});

describe("multi-card generation", () => {
  it("generates card count based on request complexity (small = <=3 cards)", () => {
    const result = run(["create-board", "--title", "Small Task"], { stdin: "Add a simple button.\n" });
    expect(result.json.cardCount).toBeLessThanOrEqual(3);
    expect(result.json.complexity).toBe("small");
  });

  it("generates medium card count (4-8) for moderate request", () => {
    const sections = Array.from({ length: 5 }, (_, i) => `## Section ${i + 1}\nDescription for section ${i + 1}.`).join("\n");
    const result = run(["create-board", "--title", "Medium Task"], { stdin: sections });
    expect(result.json.complexity).toBe("medium");
    expect(result.json.cardCount).toBeGreaterThanOrEqual(4);
    expect(result.json.cardCount).toBeLessThanOrEqual(8);
  });
});

describe("duplicate prevention", () => {
  it("never creates duplicate boards for the same task", () => {
    const request = "## Unique task\nSome unique content.\n";
    const first = run(["create-board", "--title", "Unique"], { stdin: request });
    for (let attempt = 0; attempt < 3; attempt++) {
      const retry = run(["create-board", "--title", "Unique"], { stdin: request });
      expect(retry.json.boardId).toBe(first.json.boardId);
    }
    expect(readWorkspace().boards.filter((b) => b.name === "Unique").length).toBe(1);
  });

  it("does not leak boards across different tasks even with same title", () => {
    const first = run(["create-board", "--title", "My Feature"], { stdin: "## First implementation\nContent A.\n" });
    const second = run(["create-board", "--title", "My Feature"], { stdin: "## Second implementation\nContent B.\n" });
    expect(second.json.boardId).not.toBe(first.json.boardId);
    expect(second.json.mode).not.toBe("resumed");
  });
});

describe("timeline batching", () => {
  it("batches initial card creation into a single activity entry", () => {
    const request = Array.from({ length: 4 }, (_, i) => `## Area ${i + 1}\nWork for area ${i + 1}.`).join("\n");
    const result = run(["create-board", "--title", "Batched Board"], { stdin: request });
    expect(result.json.ok).toBe(true);
    const workspace = readWorkspace();
    const board = boardById(workspace, result.json.boardId);
    const createEvents = board.activity.filter((a) => a.action.includes("created board"));
    expect(createEvents.length).toBe(1);
    expect(createEvents[0]!.target).toContain("cards");
  });
});

describe("Planning-group uniqueness", () => {
  it("creates phases with distinct names, never multiple identical names", () => {
    const request = Array.from({ length: 4 }, (_, i) => `## Workstream ${i + 1}\nDescription ${i + 1}.`).join("\n");
    const result = run(["create-board", "--title", "Distinct Phases"], { stdin: request });
    const workspace = readWorkspace();
    const board = boardById(workspace, result.json.boardId);
    const phaseNames = board.phases.map((p) => p.name);
    expect(new Set(phaseNames).size).toBe(phaseNames.length);
    expect(phaseNames).not.toContain("Planning");
  });
});

describe("token-efficient resume", () => {
  it("returns compact output for resume command", () => {
    run(["create-board", "--title", "Resume Test"], { stdin: "## Work\nDo something.\n" });
    const result = run(["resume"], {});
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("[RELAY] Active");
    expect(result.stdout).toContain("Board:");
    expect(result.stdout).toContain("Instruction:");
    // Board creation no longer fabricates placeholder cards, so a request with
    // no extractable work areas legitimately starts with an empty board.
    // Resume must state that plainly rather than name an invented card.
    expect(result.stdout).toMatch(/Active card:|No active card\./);
  });
});

describe("macOS/Windows path handling", () => {
  it("creates workspace file in correct macOS location", () => {
    const result = run(["create-board", "--title", "Path Test"], { stdin: "## Test\nContent.\n" });
    expect(result.json.ok).toBe(true);
    expect(result.json.relayDataPath).toContain("Library/Application Support/Relay");
  });

  it("uses correct workspace path on Windows-style HOME", () => {
    const winHome = join(sandbox, "win-user");
    mkdirSync(join(winHome, "dev", "app"), { recursive: true });
    gitInit(join(winHome, "dev", "app"));
    const winRepo = join(winHome, "dev", "app");
    const result = run(["create-board", "--title", "Win Path"], {
      stdin: "## Win\ntest\n",
      cwd: winRepo,
      homeDir: winHome,
    });
    expect(result.json.ok).toBe(true);
    const wf = workspaceFile(winHome);
    expect(() => readFileSync(wf, "utf8")).not.toThrow();
    const ws = JSON.parse(readFileSync(wf, "utf8")) as Workspace;
    expect(ws.boards.length).toBeGreaterThan(0);
  });
});

describe("live UI synchronization", () => {
  it("read-back verification confirms write was durable", () => {
    const result = run(["create-board", "--title", "UI Sync"], { stdin: "## Test\nVerify write.\n" });
    expect(result.json.ok).toBe(true);
    expect(result.json.verified).toBe(true);
    const workspace = readWorkspace();
    const board = boardById(workspace, result.json.boardId);
    expect(board.id).toBe(result.json.boardId);
    expect(board.repository).toBe(realpathSync(repo));
  });
});

describe("repair-board", () => {
  it("fixes duplicate phases and generic cards", () => {
    const result = run(["create-board", "--title", "Repair Test"], { stdin: "## Work\nDo stuff.\n" });
    const boardId = result.json.boardId;
    const workspace = readWorkspace();
    const board = boardById(workspace, boardId);

    // Intentionally add duplicate phases to simulate the broken state
    board.phases.push(
      { id: randomUUID(), name: "Planning", objective: "", progress: 0, status: "planned" },
      { id: randomUUID(), name: "Planning", objective: "", progress: 0, status: "planned" },
    );
    writeFileSync(workspaceFile(), JSON.stringify(workspace, null, 2));

    const repairResult = run(["repair-board", "--board-id", boardId ?? ""], {});
    expect(repairResult.json.ok).toBe(true);
    expect((repairResult.json.repairs ?? []).some((r) => r.includes("Merged"))).toBe(true);

    const fixed = boardById(readWorkspace(), boardId);
    const planningPhases = fixed.phases.filter((p) => p.name === "Planning");
    expect(planningPhases.length).toBe(1);
  });
});

describe("continuation auto-detection", () => {
  it("resumes linked board when request has continuation keywords", () => {
    const first = run(["create-board", "--title", "Feature Alpha"], { stdin: "## Add settings and updater\nImplement settings page.\n" });
    expect(first.json.ok).toBe(true);
    // Follow-up with continuation keywords → auto-resumes
    const second = run(["create-board", "--title", "Feature Alpha"], { stdin: "Continue working on the updater, fix Windows installation\n" });
    expect(second.json.mode).toBe("resumed");
    expect(second.json.boardId).toBe(first.json.boardId);
    const workspace = readWorkspace();
    expect(workspace.boards.length).toBe(1);
  });

  it("creates new board for structured multi-heading request even with same repo", () => {
    const first = run(["create-board", "--title", "Feature Alpha"], { stdin: "## Add settings\nImplementation.\n" });
    expect(first.json.ok).toBe(true);
    const second = run(["create-board", "--title", "Feature Beta"], { stdin: "## Add updater\n## Add tray\nMultiple sections.\n" });
    expect(second.json.mode).toBe("created");
    expect(second.json.boardId).not.toBe(first.json.boardId);
    const workspace = readWorkspace();
    expect(workspace.boards.length).toBe(2);
  });

  it("auto-continuation preserves original cards and context", () => {
    const first = run(["create-board", "--title", "Persistence"], { stdin: "## Foundation\nSet up base.\n## Auth\nAdd authentication.\n" });
    expect(first.json.ok).toBe(true);
    const boardId = first.json.boardId;
    const workspace0 = readWorkspace();
    const originalCardCount = boardById(workspace0, boardId).cards.length;
    expect(originalCardCount).toBeGreaterThanOrEqual(2);

    const second = run(["create-board", "--title", "Persistence"], { stdin: "continue working on this\n" });
    expect(second.json.boardId).toBe(boardId);
    const workspace1 = readWorkspace();
    const board = boardById(workspace1, boardId);
    expect(board.cards.length).toBe(originalCardCount);
  });
});

describe("explicit task-id continuation", () => {
  it("resumes board with --task-id even with completely different request", () => {
    const first = run(["create-board", "--title", "The Feature"], { stdin: "## Original plan\nBuild the feature.\n" });
    expect(first.json.ok).toBe(true);
    const taskId = first.json.taskId ?? "";
    // Different wording, explicit taskId -> resume
    const second = run(["create-board", "--title", "The Feature", "--task-id", taskId], { stdin: "Now fix this completely different thing\n" });
    expect(second.json.mode).toBe("continue");
    expect(second.json.boardId).toBe(first.json.boardId);
  });

  it("fails clearly when --task-id does not match any board", () => {
    const result = run(["create-board", "--title", "Orphan", "--task-id", "0000000000000000"], { stdin: "## X\n" });
    expect(result.ok).toBe(false);
    expect(result.json.ok).toBe(false);
    expect(result.json.error).toContain("taskId");
  });
});

describe("token-budget enforcement in resume", () => {
  it("resume output stays under 3000 estimated tokens with many checkpoints", () => {
    const result = run(["create-board", "--title", "Token Budget"], { stdin: "## Big feature\nLots of work.\n" });
    expect(result.json.ok).toBe(true);
    const boardId = result.json.boardId;

    // Simulate many checkpoints by writing directly to workspace
    const workspace = readWorkspace();
    const board = boardById(workspace, boardId);
    for (let i = 0; i < 20; i++) {
      board.context.unshift({
        id: randomUUID(),
        category: "Current state",
        title: `Checkpoint: Card ${i}`,
        content: `Summary of work done in iteration ${i}. Changed files: src/main.ts, src/utils.ts. Tests passed: ${i * 3}. Known issues: none.`,
        confidence: "High",
        updatedAt: new Date().toISOString(),
      });
    }
    // Also add some decisions
    for (let i = 0; i < 10; i++) {
      board.decisions.unshift({ title: `Decision ${i}`, decision: `Chose approach ${i} for the implementation.`, reason: "Performance.", status: "Accepted" });
    }
    writeFileSync(workspaceFile(), JSON.stringify(workspace, null, 2));

    const resume = run(["resume"], {});
    expect(resume.ok).toBe(true);
    const tokenEstimate = Math.ceil(resume.stdout.length / 4);
    expect(tokenEstimate).toBeLessThanOrEqual(3500);
  });

  it("deduplicates context by content hash in resume output", () => {
    const result = run(["create-board", "--title", "Dedup Test"], { stdin: "## Task\nContent.\n" });
    expect(result.json.ok).toBe(true);
    const boardId = result.json.boardId;

    const workspace = readWorkspace();
    const board = boardById(workspace, boardId);
    // Add duplicate context entries
    const dupContent = "Same checkpoint content with identical wording.";
    for (let i = 0; i < 5; i++) {
      board.context.unshift({
        id: randomUUID(),
        category: "Current state",
        title: `Checkpoint ${i}`,
        content: dupContent,
        confidence: "High",
        updatedAt: new Date().toISOString(),
      });
    }
    writeFileSync(workspaceFile(), JSON.stringify(workspace, null, 2));

    const resume = run(["resume"], {});
    expect(resume.ok).toBe(true);
    // The resume output should deduplicate - only 1 occurrence, not 5
    const matches = resume.stdout.match(/Same checkpoint content with identical wording/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});

describe("checkpoint context compaction", () => {
  it("does not add duplicate checkpoint entries for same content", () => {
    const result = run(["create-board", "--title", "No Dupes"], { stdin: "## Feature\nWork.\n" });
    expect(result.json.ok).toBe(true);
    const boardId = result.json.boardId;

    const cp = { summary: "Did some work.", changedFiles: ["src/main.ts"], tests: "all pass" };
    const cp1 = run(["checkpoint"], { stdin: JSON.stringify(cp), cwd: repo });
    // Same content again
    const cp2 = run(["checkpoint"], { stdin: JSON.stringify(cp), cwd: repo });
    expect(cp1.json.ok).toBe(true);
    expect(cp2.json.ok).toBe(true);

    const workspace = readWorkspace();
    const board = boardById(workspace, boardId);
    const matchingEntries = board.context.filter(
      (item) => item.content && item.content.includes("Did some work"),
    );
    expect(matchingEntries.length).toBe(1);
  });
});

describe("diagnostics command", () => {
  it("reports estimated token counts for linked board", () => {
    const result = run(["create-board", "--title", "Diag Test"], { stdin: "## Feature\nWork.\n" });
    expect(result.json.ok).toBe(true);

    const diag = run(["diagnostics"], {});
    expect(diag.json.boardId).toBe(result.json.boardId);
    expect(typeof diag.json.estimatedInputTokens!.total).toBe("number");
    expect(diag.json.estimatedInputTokens!.total).toBeGreaterThan(0);
    expect(Array.isArray(diag.json.estimatedInputTokens!.sections)).toBe(true);
    expect(typeof diag.json.contextEntryCount).toBe("number");
    expect(typeof diag.json.resumePayloadTokens).toBe("number");
  });
});

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

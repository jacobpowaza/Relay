import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { appendCheckpointToLocalWorkspace } from "../src/local-workspace.js";

import type { CheckpointInput } from "../src/protocol.js";

interface SavedWorkspace {
  boards: Array<{
    activity: unknown[];
    activeTasks?: number;
    blockers?: number;
    cards: Array<{ blocked?: boolean; columnId?: string; notes?: unknown[]; progress?: number }>;
    context: Array<{ content: string }>;
    decisions?: unknown[];
    phases?: Array<{ progress: number; status: string }>;
    progress?: number;
  }>;
}

function checkpoint(idempotencyKey = "checkpoint-1"): CheckpointInput {
  return {
    boardId: "board-1",
    cardId: "card-1",
    agent: "claude-code",
    sessionId: "session-1",
    repository: {
      root: "/repo",
      workingDirectory: "/repo",
      dirty: true,
      changedFiles: ["apps/web/components/relay-app.tsx"],
      stagedFiles: [],
    },
    kind: "files_changed",
    summary: "Fixed Relay activity and context updates.",
    filesChanged: ["apps/web/components/relay-app.tsx"],
    commandsRun: ["pnpm test"],
    tests: [],
    knownIssues: [],
    remainingWork: ["run full check"],
    idempotencyKey,
    createdAt: "2026-07-18T12:00:00.000Z",
  };
}

describe("local workspace checkpoints", () => {
  it("adds agent activity, context, and a card note to a linked board", () => {
    const path = join(mkdtempSync(join(tmpdir(), "relay-workspace-")), "workspace.json");
    writeFileSync(path, JSON.stringify({
      directories: [],
      boards: [{
        id: "board-1",
        activity: [],
        context: [],
        decisions: [],
        phases: [{ id: "phase-1", name: "Planning", objective: "", progress: 0, status: "planned" }],
        cards: [{
          id: "card-1",
          title: "Plugin updates",
          columnId: "ready",
          phaseId: "phase-1",
          progress: 0,
          criteriaDone: 0,
          criteriaTotal: 1,
          blocked: false,
          updatedAt: "2026-07-18T00:00:00.000Z",
        }],
      }],
    }));

    expect(appendCheckpointToLocalWorkspace(path, checkpoint()).updated).toBe(true);
    expect(appendCheckpointToLocalWorkspace(path, checkpoint()).updated).toBe(true);

    const workspace = JSON.parse(readFileSync(path, "utf8")) as SavedWorkspace;
    const board = workspace.boards[0];
    const card = board?.cards[0];
    const context = board?.context[0];
    if (board === undefined || card === undefined || context === undefined) throw new Error("Expected checkpoint to update the linked board.");
    expect(board.activity).toHaveLength(1);
    expect(board.activity[0]).toMatchObject({ actor: "Claude", actorKind: "claude", action: "changed files for" });
    expect(board.context).toHaveLength(1);
    expect(context.content).toContain("Remaining: run full check");
    expect(card.notes).toHaveLength(1);
    expect(card.columnId).toBe("progress");
    expect(card.progress).toBe(25);
    expect(board.activeTasks).toBe(1);
    expect(board.blockers).toBe(0);
    expect(board.progress).toBe(25);
    expect(board.phases?.[0]).toMatchObject({ progress: 25, status: "in_progress" });
  });

  it("records decision checkpoints in decisions, context, notes, activity, and timeline metrics", () => {
    const path = join(mkdtempSync(join(tmpdir(), "relay-workspace-")), "workspace.json");
    writeFileSync(path, JSON.stringify({
      directories: [],
      boards: [{
        id: "board-1",
        activity: [],
        context: [],
        decisions: [],
        phases: [{ id: "phase-1", name: "Planning", objective: "", progress: 0, status: "planned" }],
        cards: [{
          id: "card-1",
          title: "Choose persistence",
          columnId: "progress",
          phaseId: "phase-1",
          progress: 40,
          criteriaDone: 0,
          criteriaTotal: 1,
          blocked: false,
          updatedAt: "2026-07-18T00:00:00.000Z",
        }],
      }],
    }));

    const input = { ...checkpoint("decision-1"), kind: "decision_made" as const, summary: "Keep local workspace writes app-owned and atomic." };

    expect(appendCheckpointToLocalWorkspace(path, input).updated).toBe(true);

    const workspace = JSON.parse(readFileSync(path, "utf8")) as SavedWorkspace;
    const board = workspace.boards[0];
    if (board === undefined) throw new Error("Expected decision checkpoint to update the linked board.");
    expect(board.decisions).toHaveLength(1);
    expect(board.activity[0]).toMatchObject({ action: "recorded decision", target: "Choose persistence" });
    expect(board.context[0]?.content).toContain("Keep local workspace writes");
    expect(board.cards[0]?.notes).toHaveLength(1);
    expect(board.phases?.[0]).toMatchObject({ progress: 40, status: "in_progress" });
  });

  it("reports missing boards without creating fake data", () => {
    const path = join(mkdtempSync(join(tmpdir(), "relay-workspace-")), "workspace.json");
    writeFileSync(path, JSON.stringify({ directories: [], boards: [] }));

    expect(appendCheckpointToLocalWorkspace(path, checkpoint()).reason).toBe("board_not_found");
  });
});

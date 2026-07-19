import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { enqueueCheckpoint, readLocalQueue } from "../src/local-queue.js";

import type { CheckpointInput } from "../src/protocol.js";

function checkpoint(idempotencyKey: string): CheckpointInput {
  return {
    boardId: "board-1",
    agent: "codex",
    sessionId: "session-1",
    repository: {
      root: "/repo",
      workingDirectory: "/repo",
      dirty: false,
      changedFiles: [],
      stagedFiles: [],
    },
    kind: "implementation_step",
    summary: "Changed integration core.",
    filesChanged: ["integrations/core/src/index.ts"],
    commandsRun: ["pnpm test"],
    tests: [{ command: "pnpm test", status: "passed", summary: "passed" }],
    knownIssues: [],
    remainingWork: [],
    idempotencyKey,
    createdAt: "2026-07-17T00:00:00.000Z",
  };
}

describe("local queue", () => {
  it("writes atomically and deduplicates idempotency keys", () => {
    const path = join(mkdtempSync(join(tmpdir(), "relay-queue-")), "queue.json");

    enqueueCheckpoint(path, checkpoint("same"));
    enqueueCheckpoint(path, checkpoint("same"));

    expect(readLocalQueue(path).checkpoints).toHaveLength(1);
    expect(readFileSync(path, "utf8")).toContain('"schemaVersion": 1');
  });
});

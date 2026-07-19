import { describe, expect, it } from "vitest";

import { buildContextPacket } from "../src/index.js";
import type { ContextItem } from "../src/index.js";

function item(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: "context-1",
    boardId: "board-1",
    title: "Project summary",
    content: "Relay tracks development work and durable context.",
    category: "project_summary",
    status: "active",
    confidence: "high",
    relatedCardIds: [],
    relatedFilePaths: [],
    updatedAt: "2026-07-17T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("buildContextPacket", () => {
  it("excludes stale and unrelated-board context", () => {
    const packet = buildContextPacket(
      [
        item({ id: "active" }),
        item({ id: "stale", status: "superseded" }),
        item({ id: "other", boardId: "board-2" }),
      ],
      { boardId: "board-1" },
    );

    expect(packet.entries.map((entry) => entry.item.id)).toEqual(["active"]);
  });

  it("prioritizes card-specific warnings", () => {
    const packet = buildContextPacket(
      [
        item({ id: "summary" }),
        item({
          id: "warning",
          title: "Do not replace optimistic locking",
          category: "warning",
          relatedCardIds: ["card-1"],
        }),
      ],
      { boardId: "board-1", cardId: "card-1" },
    );

    expect(packet.entries[0]?.item.id).toBe("warning");
  });

  it("honors the token budget and reports omissions", () => {
    const packet = buildContextPacket(
      [
        item({ id: "first", content: "a".repeat(300) }),
        item({ id: "second", content: "b".repeat(300), category: "testing" }),
      ],
      { boardId: "board-1", tokenBudget: 128 },
    );

    expect(packet.estimatedTokens).toBeLessThanOrEqual(128);
    expect(packet.omittedCount).toBe(1);
  });
});

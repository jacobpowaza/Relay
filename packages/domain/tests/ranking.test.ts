import { describe, expect, it } from "vitest";

import { recommendNextCards } from "../src/index.js";
import type { Card } from "../src/index.js";

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    boardId: "board-1",
    columnId: "ready",
    title: "Build activity stream",
    description: "",
    type: "feature",
    priority: "normal",
    urgency: 5,
    complexity: 4,
    progress: 0,
    releaseImpact: 5,
    phaseFit: 8,
    contextReadiness: 8,
    criticalPath: false,
    blocked: false,
    dependencies: [],
    evidence: [],
    acceptanceCriteriaCount: 2,
    acceptanceCriteriaSatisfied: 0,
    updatedAt: "2026-07-17T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("recommendNextCards", () => {
  it("excludes blocked cards and cards with unmet dependencies", () => {
    const recommendations = recommendNextCards([
      card({ id: "blocked", blocked: true, priority: "critical" }),
      card({
        id: "waiting",
        dependencies: [{ cardId: "dependency", satisfied: false }],
        priority: "critical",
      }),
      card({ id: "ready" }),
    ]);

    expect(recommendations.map((item) => item.cardId)).toEqual(["ready"]);
  });

  it("ranks critical-path and urgent work above ordinary work", () => {
    const recommendations = recommendNextCards([
      card({ id: "ordinary", title: "Ordinary task" }),
      card({
        id: "critical",
        title: "Unblock release",
        priority: "urgent",
        urgency: 10,
        criticalPath: true,
      }),
    ]);

    expect(recommendations[0]?.cardId).toBe("critical");
    expect(recommendations[0]?.reason).toContain("urgent priority");
  });

  it("returns an empty list for an invalid limit", () => {
    expect(recommendNextCards([card()], undefined, 0)).toEqual([]);
  });
});

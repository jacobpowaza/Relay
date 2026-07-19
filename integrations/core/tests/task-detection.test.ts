import { describe, expect, it } from "vitest";

import { detectLongTask } from "../src/task-detection.js";

describe("detectLongTask", () => {
  it("tracks multi-phase work likely to cross sessions", () => {
    const decision = detectLongTask(`
      Build Claude Code and Codex integrations in phases.
      Make work resumable across sessions, crashes, handoffs, and context limits.
      Include testing, review, release, and architecture docs.
    `);

    expect(decision.shouldTrack).toBe(true);
    expect(decision.signals.map((signal) => signal.key)).toContain("multi_phase");
    expect(decision.signals.map((signal) => signal.key)).toContain("handoff_likely");
  });

  it("does not track a tiny one-file fix", () => {
    const decision = detectLongTask("Fix typo in README title.");

    expect(decision.shouldTrack).toBe(false);
    expect(decision.confidence).toBe("low");
  });
});

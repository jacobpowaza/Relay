import { describe, expect, it } from "vitest";

import { defaultCompletionPolicy, evaluateCompletion } from "../src/index.js";
import type { ActorRef, EvidenceCheckpoint, EvidenceRecord } from "../src/index.js";

const actor: ActorRef = { id: "actor-1", name: "Jacob", type: "human" };

function records(...checkpoints: EvidenceCheckpoint[]): EvidenceRecord[] {
  return checkpoints.map((checkpoint) => ({
    actor,
    checkpoint,
    recordedAt: "2026-07-17T12:00:00.000Z",
    valid: true,
  }));
}

describe("evaluateCompletion", () => {
  it("does not infer completion from a claim alone", () => {
    const result = evaluateCompletion(records("implementation_claimed_complete"));

    expect(result.state).toBe("not_started");
    expect(result.missing.implementation_complete).toContain("code_changed");
    expect(result.missing.implementation_complete).toContain(
      "acceptance_criteria_satisfied",
    );
  });

  it("keeps verification separate from implementation completion", () => {
    const result = evaluateCompletion(records(...defaultCompletionPolicy.implementation));

    expect(result.state).toBe("implementation_complete");
    expect(result.missing.verified).toEqual(["tests_passed", "review_completed"]);
  });

  it("reaches production verification only with every required checkpoint", () => {
    const result = evaluateCompletion(
      records(
        ...defaultCompletionPolicy.implementation,
        ...defaultCompletionPolicy.verified,
        ...defaultCompletionPolicy.shipped,
        ...defaultCompletionPolicy.production,
      ),
    );

    expect(result.state).toBe("production_verified");
    expect(result.missing.production_verified).toEqual([]);
  });

  it("ignores invalidated evidence", () => {
    const result = evaluateCompletion([
      ...records(...defaultCompletionPolicy.implementation),
      {
        actor,
        checkpoint: "code_changed",
        recordedAt: "2026-07-17T13:00:00.000Z",
        valid: false,
      },
    ]);

    expect(result.state).toBe("work_started");
    expect(result.missing.implementation_complete).toContain("code_changed");
  });
});

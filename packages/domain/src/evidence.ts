import type {
  CompletionEvaluation,
  CompletionPolicy,
  DerivedCompletionState,
  EvidenceCheckpoint,
  EvidenceRecord,
} from "./types.js";

export const defaultCompletionPolicy: CompletionPolicy = {
  implementation: [
    "work_started",
    "code_changed",
    "implementation_claimed_complete",
    "acceptance_criteria_satisfied",
  ],
  verified: ["tests_passed", "review_completed"],
  shipped: ["deployed"],
  production: ["production_verified"],
};

function missingCheckpoints(
  required: readonly EvidenceCheckpoint[],
  valid: ReadonlySet<EvidenceCheckpoint>,
): EvidenceCheckpoint[] {
  return required.filter((checkpoint) => !valid.has(checkpoint));
}

export function evaluateCompletion(
  records: readonly EvidenceRecord[],
  policy: CompletionPolicy = defaultCompletionPolicy,
): CompletionEvaluation {
  const latestByCheckpoint = new Map<EvidenceCheckpoint, EvidenceRecord>();
  for (const record of records) {
    const current = latestByCheckpoint.get(record.checkpoint);
    if (current === undefined || record.recordedAt >= current.recordedAt) {
      latestByCheckpoint.set(record.checkpoint, record);
    }
  }

  const valid = new Set(
    [...latestByCheckpoint.values()]
      .filter((record) => record.valid)
      .map((record) => record.checkpoint),
  );

  const missing = {
    implementation_complete: missingCheckpoints(policy.implementation, valid),
    verified: missingCheckpoints([...policy.implementation, ...policy.verified], valid),
    shipped: missingCheckpoints(
      [...policy.implementation, ...policy.verified, ...policy.shipped],
      valid,
    ),
    production_verified: missingCheckpoints(
      [
        ...policy.implementation,
        ...policy.verified,
        ...policy.shipped,
        ...policy.production,
      ],
      valid,
    ),
  };

  let state: DerivedCompletionState = "not_started";
  if (valid.has("work_started")) state = "work_started";
  if (missing.implementation_complete.length === 0) state = "implementation_complete";
  if (missing.verified.length === 0) state = "verified";
  if (missing.shipped.length === 0) state = "shipped";
  if (missing.production_verified.length === 0) state = "production_verified";

  return {
    missing,
    state,
    validCheckpoints: [...valid].sort(),
  };
}

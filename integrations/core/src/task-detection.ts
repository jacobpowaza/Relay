export interface LongTaskSignal {
  key:
    | "architectural_change"
    | "handoff_likely"
    | "large_refactor"
    | "migration"
    | "multi_phase"
    | "numerous_files"
    | "plan_with_many_tasks"
    | "research_then_implementation"
    | "test_review_release"
    | "usage_limit_risk";
  weight: number;
  reason: string;
}

export interface LongTaskDecision {
  shouldTrack: boolean;
  confidence: "high" | "low" | "medium";
  signals: LongTaskSignal[];
  reason: string;
}

const signalPatterns: Array<{ signal: LongTaskSignal; patterns: RegExp[] }> = [
  {
    signal: { key: "multi_phase", weight: 3, reason: "request names multiple phases or stages" },
    patterns: [/\bphase\s+\d+\b/i, /\bstage\s+\d+\b/i, /\bphases?\b/i, /\bstages?\b/i, /\broadmap\b/i],
  },
  {
    signal: { key: "handoff_likely", weight: 3, reason: "request mentions handoff or resumption" },
    patterns: [/\bhandoff\b/i, /\bresum(e|able|ption)\b/i, /\bacross sessions\b/i, /\bcontext-window\b/i],
  },
  {
    signal: { key: "architectural_change", weight: 3, reason: "request changes architecture or protocol" },
    patterns: [/\barchitecture\b/i, /\bprotocol\b/i, /\bcontract\b/i, /\bshared core\b/i],
  },
  {
    signal: { key: "large_refactor", weight: 2, reason: "request includes major refactor language" },
    patterns: [/\bmajor refactor\b/i, /\brewrite\b/i, /\bcross-module\b/i],
  },
  {
    signal: { key: "migration", weight: 2, reason: "request includes migration or schema work" },
    patterns: [/\bmigration\b/i, /\bschema\b/i, /\bbackfill\b/i],
  },
  {
    signal: { key: "research_then_implementation", weight: 2, reason: "request requires research then implementation" },
    patterns: [/\bresearch\b/i, /\binvestigate\b/i, /\bofficial.*docs\b/i],
  },
  {
    signal: { key: "test_review_release", weight: 2, reason: "request spans testing, review, deploy, or release" },
    patterns: [/\btest(ing|s)?\b/i, /\breview\b/i, /\bdeploy(ment)?\b/i, /\brelease\b/i],
  },
  {
    signal: { key: "usage_limit_risk", weight: 2, reason: "request is likely to hit context or usage limits" },
    patterns: [/\busage limit\b/i, /\bcontext (window|limit)\b/i, /\bcrash(es)?\b/i],
  },
  {
    signal: { key: "plan_with_many_tasks", weight: 2, reason: "request includes a detailed multi-item plan" },
    patterns: [/\n\s*(\d+\.|\*)\s+/],
  },
  {
    signal: { key: "numerous_files", weight: 1, reason: "request implies many files or systems" },
    patterns: [/\bnumerous files\b/i, /\bmany files\b/i, /\bsystems\b/i],
  },
];

export function detectLongTask(request: string): LongTaskDecision {
  const signals: LongTaskSignal[] = [];
  for (const candidate of signalPatterns) {
    if (candidate.patterns.some((pattern) => pattern.test(request))) {
      signals.push(candidate.signal);
    }
  }

  const score = signals.reduce((total, signal) => total + signal.weight, 0);
  const shouldTrack = score >= 4 || signals.some((signal) => signal.weight >= 3) && score >= 3;
  const confidence = score >= 7 ? "high" : score >= 4 ? "medium" : "low";
  const reason = signals.length === 0
    ? "No durable-work signals detected."
    : signals.map((signal) => signal.reason).join("; ");

  return { shouldTrack, confidence, signals, reason };
}

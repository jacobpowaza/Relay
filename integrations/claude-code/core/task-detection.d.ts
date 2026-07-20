export interface LongTaskSignal {
    key: "architectural_change" | "handoff_likely" | "large_refactor" | "migration" | "multi_phase" | "numerous_files" | "plan_with_many_tasks" | "research_then_implementation" | "test_review_release" | "usage_limit_risk";
    weight: number;
    reason: string;
}
export interface LongTaskDecision {
    shouldTrack: boolean;
    confidence: "high" | "low" | "medium";
    signals: LongTaskSignal[];
    reason: string;
}
export declare function detectLongTask(request: string): LongTaskDecision;
//# sourceMappingURL=task-detection.d.ts.map
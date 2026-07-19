import { z } from "zod";

export const entityIdSchema = z.string().min(1).max(100);

export const actorSchema = z.object({
  id: entityIdSchema,
  name: z.string().trim().min(1).max(120),
  type: z.enum(["agent", "human", "system"]),
});

export const cardTypeSchema = z.enum([
  "bug",
  "decision",
  "documentation",
  "feature",
  "refactor",
  "release",
  "research",
  "security",
  "task",
  "technical_debt",
  "test",
]);

export const cardPrioritySchema = z.enum(["critical", "high", "low", "normal", "urgent"]);

export const evidenceCheckpointSchema = z.enum([
  "acceptance_criteria_satisfied",
  "code_changed",
  "deployed",
  "human_verified",
  "implementation_claimed_complete",
  "production_verified",
  "review_completed",
  "tests_passed",
  "tests_written",
  "work_started",
]);

export const createBoardSchema = z.object({
  directoryId: entityIdSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).default(""),
  detailedPlan: z.string().max(200_000).optional(),
  repositoryUrl: z.url().max(2_000).optional(),
});

export const createCardSchema = z.object({
  boardId: entityIdSchema,
  columnId: entityIdSchema,
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(20_000).default(""),
  type: cardTypeSchema.default("task"),
  priority: cardPrioritySchema.default("normal"),
  urgency: z.number().int().min(0).max(10).default(5),
  complexity: z.number().int().min(0).max(10).default(5),
  expectedVersion: z.number().int().positive().optional(),
});

export const updateCardStatusSchema = z.object({
  cardId: entityIdSchema,
  columnId: entityIdSchema,
  expectedVersion: z.number().int().positive(),
});

export const recordEvidenceSchema = z.object({
  cardId: entityIdSchema,
  checkpoint: evidenceCheckpointSchema,
  note: z.string().trim().max(2_000).optional(),
  sourceId: entityIdSchema.optional(),
  expectedVersion: z.number().int().positive(),
});

export const relayErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      "RELAY_BLOCKED",
      "RELAY_CONFLICT",
      "RELAY_FORBIDDEN",
      "RELAY_NOT_FOUND",
      "RELAY_UNAUTHENTICATED",
      "RELAY_VALIDATION_FAILED",
    ]),
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const gitChangeKindSchema = z.enum([
  "conflicted",
  "modified",
  "staged",
  "staged_modified",
  "untracked",
]);

export const gitRiskLevelSchema = z.enum(["artifact", "secret"]);

export const gitCommitSelectionSchema = z.object({
  id: entityIdSchema,
  message: z.string().trim().min(1).max(5_000),
  paths: z.array(z.string().min(1).max(4_096)).min(1).max(500),
});

export const prepareGitCommitSchema = z.object({
  boardId: entityIdSchema,
  snapshotId: z.string().min(32).max(128),
  commits: z.array(gitCommitSelectionSchema).min(1).max(20),
  acknowledgedRiskPaths: z.array(z.string().min(1).max(4_096)).max(500).default([]),
});

export const executeGitCommitSchema = z.object({
  confirmationToken: z.string().uuid(),
  push: z.boolean(),
});

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type CreateCardInput = z.infer<typeof createCardSchema>;
export type ExecuteGitCommitInput = z.infer<typeof executeGitCommitSchema>;
export type GitChangeKind = z.infer<typeof gitChangeKindSchema>;
export type GitCommitSelection = z.infer<typeof gitCommitSelectionSchema>;
export type GitRiskLevel = z.infer<typeof gitRiskLevelSchema>;
export type PrepareGitCommitInput = z.infer<typeof prepareGitCommitSchema>;
export type RecordEvidenceInput = z.infer<typeof recordEvidenceSchema>;
export type RelayError = z.infer<typeof relayErrorSchema>;
export type UpdateCardStatusInput = z.infer<typeof updateCardStatusSchema>;

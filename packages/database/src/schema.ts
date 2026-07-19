import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const actorType = pgEnum("actor_type", ["agent", "human", "system"]);
export const cardPriority = pgEnum("card_priority", [
  "low",
  "normal",
  "high",
  "urgent",
  "critical",
]);
export const cardType = pgEnum("card_type", [
  "feature",
  "task",
  "bug",
  "refactor",
  "research",
  "test",
  "documentation",
  "security",
  "decision",
  "release",
  "technical_debt",
]);
export const contextStatus = pgEnum("context_status", [
  "active",
  "outdated",
  "disputed",
  "superseded",
]);
export const evidenceCheckpoint = pgEnum("evidence_checkpoint", [
  "work_started",
  "code_changed",
  "implementation_claimed_complete",
  "tests_written",
  "tests_passed",
  "acceptance_criteria_satisfied",
  "review_completed",
  "human_verified",
  "deployed",
  "production_verified",
]);
export const workspaceRole = pgEnum("workspace_role", ["owner", "admin", "member", "viewer"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("workspaces_slug_unique").on(table.slug)],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: workspaceRole("role").default("member").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const directories = pgTable(
  "directories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    rank: text("rank").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [index("directories_workspace_rank_idx").on(table.workspaceId, table.rank)],
);

export const boards = pgTable(
  "boards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    directoryId: uuid("directory_id")
      .references(() => directories.id, { onDelete: "restrict" })
      .notNull(),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    repositoryUrl: text("repository_url"),
    currentPhaseId: uuid("current_phase_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [index("boards_directory_updated_idx").on(table.directoryId, table.updatedAt)],
);

export const boardColumns = pgTable(
  "board_columns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardId: uuid("board_id")
      .references(() => boards.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    behavior: text("behavior").notNull(),
    rank: text("rank").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("board_columns_board_name_unique").on(table.boardId, table.name)],
);

export const phases = pgTable(
  "phases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardId: uuid("board_id")
      .references(() => boards.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    objective: text("objective").default("").notNull(),
    status: text("status").default("planned").notNull(),
    rank: text("rank").notNull(),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [index("phases_board_rank_idx").on(table.boardId, table.rank)],
);

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardId: uuid("board_id")
      .references(() => boards.id, { onDelete: "cascade" })
      .notNull(),
    columnId: uuid("column_id")
      .references(() => boardColumns.id, { onDelete: "restrict" })
      .notNull(),
    phaseId: uuid("phase_id").references(() => phases.id, { onDelete: "set null" }),
    parentId: uuid("parent_id"),
    title: text("title").notNull(),
    description: text("description").default("").notNull(),
    type: cardType("type").default("task").notNull(),
    priority: cardPriority("priority").default("normal").notNull(),
    urgency: integer("urgency").default(5).notNull(),
    complexity: integer("complexity").default(5).notNull(),
    estimatedEffort: integer("estimated_effort"),
    actualEffort: integer("actual_effort"),
    rank: text("rank").notNull(),
    blocked: boolean("blocked").default(false).notNull(),
    assignedActorId: uuid("assigned_actor_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    index("cards_board_column_rank_idx").on(table.boardId, table.columnId, table.rank),
    index("cards_phase_idx").on(table.phaseId),
  ],
);

export const cardDependencies = pgTable(
  "card_dependencies",
  {
    cardId: uuid("card_id")
      .references(() => cards.id, { onDelete: "cascade" })
      .notNull(),
    dependsOnCardId: uuid("depends_on_card_id")
      .references(() => cards.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.cardId, table.dependsOnCardId] })],
);

export const acceptanceCriteria = pgTable(
  "acceptance_criteria",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cardId: uuid("card_id")
      .references(() => cards.id, { onDelete: "cascade" })
      .notNull(),
    description: text("description").notNull(),
    satisfied: boolean("satisfied").default(false).notNull(),
    rank: text("rank").notNull(),
    ...timestamps,
  },
  (table) => [index("acceptance_criteria_card_rank_idx").on(table.cardId, table.rank)],
);

export const evidenceRecords = pgTable(
  "evidence_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cardId: uuid("card_id")
      .references(() => cards.id, { onDelete: "cascade" })
      .notNull(),
    checkpoint: evidenceCheckpoint("checkpoint").notNull(),
    actorId: uuid("actor_id").notNull(),
    actorType: actorType("actor_type").notNull(),
    note: text("note"),
    sourceId: text("source_id"),
    valid: boolean("valid").default(true).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("evidence_card_checkpoint_idx").on(table.cardId, table.checkpoint)],
);

export const planDocuments = pgTable(
  "plan_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardId: uuid("board_id")
      .references(() => boards.id, { onDelete: "cascade" })
      .notNull(),
    content: text("content").default("").notNull(),
    clientSequence: integer("client_sequence").default(0).notNull(),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("plan_documents_board_unique").on(table.boardId)],
);

export const planVersions = pgTable(
  "plan_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planDocumentId: uuid("plan_document_id")
      .references(() => planDocuments.id, { onDelete: "cascade" })
      .notNull(),
    content: text("content").notNull(),
    createdBy: uuid("created_by").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("plan_versions_document_created_idx").on(table.planDocumentId, table.createdAt)],
);

export const contextItems = pgTable(
  "context_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardId: uuid("board_id")
      .references(() => boards.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    category: text("category").notNull(),
    status: contextStatus("status").default("active").notNull(),
    confidence: text("confidence").default("medium").notNull(),
    source: text("source").notNull(),
    relatedFilePaths: text("related_file_paths").array().default(sql`ARRAY[]::text[]`).notNull(),
    supersededById: uuid("superseded_by_id"),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [index("context_board_status_idx").on(table.boardId, table.status)],
);

export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id"),
    actorId: uuid("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    actorType: actorType("actor_type").notNull(),
    action: text("action").notNull(),
    targetId: text("target_id").notNull(),
    targetType: text("target_type").notNull(),
    source: text("source").notNull(),
    previous: jsonb("previous"),
    next: jsonb("next"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("activity_workspace_time_idx").on(table.workspaceId, table.occurredAt)],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    topic: text("topic").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payload: jsonb("payload").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("outbox_available_idx").on(table.processedAt, table.availableAt)],
);

export const boardsRelations = relations(boards, ({ many, one }) => ({
  columns: many(boardColumns),
  cards: many(cards),
  directory: one(directories, { fields: [boards.directoryId], references: [directories.id] }),
  phases: many(phases),
}));

export const cardsRelations = relations(cards, ({ one, many }) => ({
  board: one(boards, { fields: [cards.boardId], references: [boards.id] }),
  column: one(boardColumns, { fields: [cards.columnId], references: [boardColumns.id] }),
  criteria: many(acceptanceCriteria),
  evidence: many(evidenceRecords),
  phase: one(phases, { fields: [cards.phaseId], references: [phases.id] }),
}));

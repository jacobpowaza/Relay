export type EntityId = string;

export type ActorType = "agent" | "human" | "system";

export interface ActorRef {
  id: EntityId;
  name: string;
  type: ActorType;
}

export type CardType =
  | "bug"
  | "decision"
  | "documentation"
  | "feature"
  | "refactor"
  | "release"
  | "research"
  | "security"
  | "task"
  | "technical_debt"
  | "test";

export type CardPriority = "critical" | "high" | "low" | "normal" | "urgent";

export type EvidenceCheckpoint =
  | "acceptance_criteria_satisfied"
  | "code_changed"
  | "deployed"
  | "human_verified"
  | "implementation_claimed_complete"
  | "production_verified"
  | "review_completed"
  | "tests_passed"
  | "tests_written"
  | "work_started";

export type DerivedCompletionState =
  | "implementation_complete"
  | "not_started"
  | "production_verified"
  | "shipped"
  | "verified"
  | "work_started";

export interface EvidenceRecord {
  checkpoint: EvidenceCheckpoint;
  recordedAt: string;
  actor: ActorRef;
  note?: string;
  sourceId?: EntityId;
  valid: boolean;
}

export interface CompletionPolicy {
  implementation: readonly EvidenceCheckpoint[];
  production: readonly EvidenceCheckpoint[];
  shipped: readonly EvidenceCheckpoint[];
  verified: readonly EvidenceCheckpoint[];
}

export interface CompletionEvaluation {
  missing: Record<Exclude<DerivedCompletionState, "not_started" | "work_started">, EvidenceCheckpoint[]>;
  state: DerivedCompletionState;
  validCheckpoints: EvidenceCheckpoint[];
}

export interface CardDependency {
  cardId: EntityId;
  satisfied: boolean;
}

export interface Card {
  id: EntityId;
  boardId: EntityId;
  phaseId?: EntityId;
  columnId: EntityId;
  title: string;
  description: string;
  type: CardType;
  priority: CardPriority;
  urgency: number;
  complexity: number;
  progress: number;
  releaseImpact: number;
  phaseFit: number;
  contextReadiness: number;
  criticalPath: boolean;
  blocked: boolean;
  dependencies: CardDependency[];
  evidence: EvidenceRecord[];
  acceptanceCriteriaCount: number;
  acceptanceCriteriaSatisfied: number;
  assignedActorId?: EntityId;
  updatedAt: string;
  version: number;
}

export interface TaskScoreFactor {
  key:
    | "complexity"
    | "context_readiness"
    | "critical_path"
    | "existing_progress"
    | "ownership"
    | "phase_fit"
    | "priority"
    | "release_impact"
    | "urgency";
  score: number;
  explanation: string;
}

export interface TaskRecommendation {
  cardId: EntityId;
  title: string;
  score: number;
  factors: TaskScoreFactor[];
  reason: string;
}

export interface ActivityEvent {
  id: EntityId;
  workspaceId: EntityId;
  boardId?: EntityId;
  sessionId?: EntityId;
  actor: ActorRef;
  action: string;
  targetId: EntityId;
  targetType: string;
  occurredAt: string;
  source: "api" | "cli" | "mcp" | "system" | "web";
  previous?: Readonly<Record<string, unknown>>;
  next?: Readonly<Record<string, unknown>>;
}

export interface ContextItem {
  id: EntityId;
  boardId: EntityId;
  title: string;
  content: string;
  category:
    | "architecture"
    | "blocker"
    | "coding_convention"
    | "command"
    | "current_state"
    | "deployment"
    | "discovery"
    | "environment"
    | "important_file"
    | "known_limitation"
    | "open_question"
    | "project_summary"
    | "risk"
    | "testing"
    | "warning";
  status: "active" | "disputed" | "outdated" | "superseded";
  confidence: "high" | "low" | "medium";
  relatedCardIds: EntityId[];
  relatedFilePaths: string[];
  updatedAt: string;
  version: number;
}

export interface ContextPacketEntry {
  item: ContextItem;
  score: number;
  estimatedTokens: number;
  reason: string;
}

export interface ContextPacket {
  boardId: EntityId;
  cardId?: EntityId;
  entries: ContextPacketEntry[];
  estimatedTokens: number;
  omittedCount: number;
}

// --- Discovery -----------------------------------------------------------

export type DiscoveryStatus = "current" | "changed" | "new" | "stale" | "never";
export type ConfidenceLevel = "high" | "medium" | "low";

export interface DiscoveryEntry {
  filePath: string;
  purpose: string;
  importantExports: string[];
  relatedFiles: string[];
  features: string[];
  dependencies: string[];
  lastModified: string;
  contentHash: string;
  lastDiscovered: string;
  discoveredBy: string;
  confidence: ConfidenceLevel;
  status: DiscoveryStatus;
}

export interface DiscoveryFeature {
  name: string;
  description: string;
  filePaths: string[];
}

export interface DiscoveryIndex {
  boardId: EntityId;
  entries: DiscoveryEntry[];
  features: DiscoveryFeature[];
  lastFullDiscovery: string | null;
  coverage: number;
  staleRelationshipCount: number;
  discoveryCount: number;
  version: number;
}

export type RelayView =
  | "activity"
  | "board"
  | "blockers"
  | "context"
  | "decisions"
  | "discovery"
  | "plan"
  | "timeline";

export interface Directory {
  id: string;
  name: string;
  path?: string;
}

export interface Phase {
  id: string;
  name: string;
  objective: string;
  progress: number;
  status: "complete" | "in_progress" | "planned";
}

export interface RelayCard {
  id: string;
  archivedAt?: string | undefined;
  title: string;
  description: string;
  columnId: string;
  phaseId: string;
  type: "bug" | "decision" | "feature" | "research" | "security" | "task" | "test";
  priority: "critical" | "high" | "low" | "normal" | "urgent";
  tags: string[];
  notes?: CardNote[];
  progress: number;
  criteriaDone: number;
  criteriaTotal: number;
  blocked: boolean;
  owner: string;
  updatedAt: string;
}

export type RelayTagTone = "blue" | "coral" | "gray" | "green" | "orange" | "violet";

export interface RelayTag {
  name: string;
  tone: RelayTagTone;
}

export interface CardNote {
  id: string;
  body: string;
  createdAt: string;
  author: string;
}

export interface BoardColumn {
  id: string;
  name: string;
  tone: "blue" | "coral" | "gray" | "green" | "orange" | "violet";
}

export interface ContextRecord {
  id: string;
  category: "Architecture" | "Current state" | "Decision" | "Important file" | "Warning";
  title: string;
  content: string;
  confidence: "High" | "Medium";
  updatedAt: string;
}

export interface ActivityRecord {
  id: string;
  actor: string;
  actorKind?: "agent" | "claude" | "codex" | "human";
  action: string;
  target: string;
  time: string;
  tone: "blue" | "green" | "orange" | "violet";
}

export interface DecisionRecord {
  id: string;
  title: string;
  decision: string;
  reason: string;
  status: "Accepted" | "Proposed";
}

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
  confidence: "high" | "medium" | "low";
  status: "current" | "changed" | "new" | "stale" | "never";
  /**
   * True once an agent wrote this purpose, absent while it is still the
   * heuristic pattern-match. Also the ledger the enrichment run bills against:
   * the default candidate set is every entry where this is not true, so a
   * re-run never re-pays for a summary it already has.
   */
  enriched?: boolean;
}

export interface DiscoveryFeature {
  name: string;
  description: string;
  filePaths: string[];
}

export interface DiscoveryIndex {
  boardId?: string;
  repoPath: string;
  entries: DiscoveryEntry[];
  features: DiscoveryFeature[];
  lastFullDiscovery: string | null;
  lastIncrementalDiscovery?: string | null;
  coverage: number;
  staleRelationshipCount: number;
  discoveryCount: number;
  version: number;
  /** Written by the enrichment pass; both absent until one has run. */
  enrichedCount?: number;
  lastEnrichment?: string;
}

export interface RelayBoard {
  id: string;
  archivedAt?: string | undefined;
  directoryId: string;
  name: string;
  description: string;
  repository: string;
  currentPhase: string;
  progress: number;
  activeTasks: number;
  blockers: number;
  lastActivity: string;
  owner: string;
  plan: string;
  columns: BoardColumn[];
  cards: RelayCard[];
  phases: Phase[];
  context: ContextRecord[];
  activity: ActivityRecord[];
  decisions: DecisionRecord[];
}

export interface RelayWorkspaceData {
  directories: Directory[];
  boards: RelayBoard[];
  tags?: RelayTag[];
  settings?: RelaySettings;
  discoveries?: Record<string, DiscoveryIndex>;
}

export interface RelaySettings {
  displayName: string;
  defaultView: RelayView;
  appearance: "dark" | "light" | "system";
  density: "comfortable" | "compact";
  performanceMode: boolean;
  reduceMotion: boolean;
  compactCards: boolean;
  showStoragePath: boolean;
  activityLimit: number;
  boardColumnWidth: number;
}

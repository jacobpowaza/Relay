export type RelayView =
  | "activity"
  | "board"
  | "blockers"
  | "context"
  | "decisions"
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

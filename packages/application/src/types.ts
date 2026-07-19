export interface ApplicationActor {
  id: string;
  name: string;
  type: "agent" | "human" | "system";
  workspaceId: string;
}

export interface ApplicationBoard {
  id: string;
  workspaceId: string;
  directoryId: string;
  name: string;
  description: string;
  detailedPlan: string;
  repositoryUrl?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationCard {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  urgency: number;
  complexity: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationActivity {
  id: string;
  workspaceId: string;
  boardId?: string;
  actorId: string;
  actorName: string;
  actorType: ApplicationActor["type"];
  action: string;
  targetId: string;
  targetType: "board" | "card" | "plan";
  previous?: Readonly<Record<string, unknown>>;
  next?: Readonly<Record<string, unknown>>;
  occurredAt: string;
}

export interface RelayState {
  boards: ApplicationBoard[];
  cards: ApplicationCard[];
  activity: ApplicationActivity[];
}

export interface RelayStore {
  transact<T>(operation: (state: RelayState) => T): T;
  read(): Readonly<RelayState>;
  getIdempotent<T>(key: string): T | undefined;
  saveIdempotent<T>(key: string, value: T): void;
}

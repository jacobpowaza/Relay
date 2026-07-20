import type { AgentKind, CheckpointInput } from "./protocol.js";
export interface LocalWorkspaceCheckpointResult {
    reason?: string;
    updated: boolean;
}
export declare function defaultLocalWorkspacePath(platform?: NodeJS.Platform, home?: string): string;
export declare function appendCheckpointToLocalWorkspace(workspacePath: string, checkpoint: CheckpointInput): LocalWorkspaceCheckpointResult;
export declare function checkpointFromSessionEndInput(input: unknown, agent: AgentKind, boardId: string): CheckpointInput;
//# sourceMappingURL=local-workspace.d.ts.map
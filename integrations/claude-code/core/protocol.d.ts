export declare const relayPluginProtocolVersion = "2026-07-17.v1";
export type AgentKind = "claude-code" | "codex" | "human" | "unknown";
export interface RepositoryIdentity {
    root: string;
    workingDirectory: string;
    remoteUrl?: string;
    branch?: string;
    baseBranch?: string;
    headCommit?: string;
    dirty: boolean;
    changedFiles: string[];
    stagedFiles: string[];
    worktree?: string;
}
export interface BoardMatchQuery {
    repository: RepositoryIdentity;
    projectName?: string;
    branchName?: string;
    requestSummary?: string;
}
export interface IntegrationBoardSummary {
    boardId: string;
    boardVersion: number;
    name: string;
    objective: string;
    activePhase?: string;
    activeCard?: IntegrationTaskSummary;
    blockers: string[];
    recentDecisions: string[];
    recommendedNextAction: string;
    updatedAt: string;
}
export interface IntegrationTaskSummary {
    cardId: string;
    title: string;
    status: string;
    priority: string;
    complexity: number;
    dependencies: string[];
    acceptanceCriteria: string[];
    relevantFiles: string[];
}
export interface ContextRecordMetadata {
    boardId: string;
    cardId?: string;
    repositoryRoot?: string;
    branch?: string;
    commit?: string;
    filePaths: string[];
    symbols: string[];
    category: "architecture" | "blocker" | "decision" | "error" | "file_reference" | "git_activity" | "handoff" | "project_overview" | "requirement" | "task_progress" | "test_result" | "user_constraint";
    sourceAgent: AgentKind;
    sessionId: string;
    importance: "high" | "low" | "medium";
    tags: string[];
}
export interface ContextRecord {
    id: string;
    title: string;
    summary: string;
    content?: string;
    createdAt: string;
    updatedAt: string;
    metadata: ContextRecordMetadata;
}
export interface CheckpointInput {
    boardId: string;
    cardId?: string;
    agent: AgentKind;
    sessionId: string;
    repository: RepositoryIdentity;
    kind: "blocker_discovered" | "card_completed" | "card_started" | "decision_made" | "files_changed" | "handoff" | "implementation_step" | "session_end" | "tests_failed" | "tests_passed" | "tests_run";
    summary: string;
    filesChanged: string[];
    commandsRun: string[];
    tests: Array<{
        command: string;
        status: "failed" | "not_run" | "passed";
        summary: string;
    }>;
    knownIssues: string[];
    remainingWork: string[];
    recommendedNextTask?: string;
    idempotencyKey: string;
    createdAt: string;
}
export interface SessionBootstrap {
    protocolVersion: string;
    enabled: boolean;
    sourceAgent: AgentKind;
    repository?: RepositoryIdentity;
    connectedBoard?: IntegrationBoardSummary;
    syncState: "disabled" | "offline" | "pending" | "synced" | "unlinked";
    pendingLocalUpdates: number;
    compactReminder: string;
}
//# sourceMappingURL=protocol.d.ts.map
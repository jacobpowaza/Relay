import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
export function defaultLocalWorkspacePath(platform = process.platform, home = homedir()) {
    if (platform === "darwin")
        return join(home, "Library", "Application Support", "Relay", "relay-data", "workspace.json");
    if (platform === "win32") {
        return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Relay", "relay-data", "workspace.json");
    }
    return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "Relay", "relay-data", "workspace.json");
}
export function appendCheckpointToLocalWorkspace(workspacePath, checkpoint) {
    if (!existsSync(workspacePath))
        return { updated: false, reason: "workspace_missing" };
    const workspace = JSON.parse(readFileSync(workspacePath, "utf8"));
    if (!Array.isArray(workspace.boards) || !Array.isArray(workspace.directories)) {
        return { updated: false, reason: "invalid_workspace" };
    }
    const board = workspace.boards.find((item) => item.id === checkpoint.boardId);
    if (board === undefined)
        return { updated: false, reason: "board_not_found" };
    const activityId = `activity-${checkpoint.idempotencyKey}`;
    const contextId = `context-${checkpoint.idempotencyKey}`;
    const noteId = `note-${checkpoint.idempotencyKey}`;
    const activity = board.activity ?? [];
    const context = board.context ?? [];
    const actor = agentDisplayName(checkpoint.agent);
    const content = checkpointContent(checkpoint);
    const card = checkpoint.cardId !== undefined && Array.isArray(board.cards)
        ? board.cards.find((item) => item.id === checkpoint.cardId)
        : undefined;
    const target = card?.title ?? checkpoint.summary;
    board.activity = activity.some((item) => item.id === activityId)
        ? activity
        : [
            {
                id: activityId,
                actor,
                actorKind: agentActorKind(checkpoint.agent),
                action: activityAction(checkpoint.kind),
                target,
                time: checkpoint.createdAt,
                tone: activityTone(checkpoint.kind),
            },
            ...activity,
        ];
    if (content !== "" && !context.some((item) => item.id === contextId)) {
        const confidence = checkpoint.kind === "decision_made" || checkpoint.kind === "blocker_discovered" ? "High" : "Medium";
        board.context = [
            {
                id: contextId,
                category: contextCategory(checkpoint.kind),
                title: contextTitle(checkpoint),
                content,
                confidence,
                updatedAt: checkpoint.createdAt,
            },
            ...context,
        ].slice(0, 60);
    }
    if (card !== undefined) {
        const notes = card.notes ?? [];
        card.notes = notes.some((item) => item.id === noteId)
            ? notes
            : [{ id: noteId, body: content || checkpoint.summary, createdAt: checkpoint.createdAt, author: actor }, ...notes];
        updateCardFromCheckpoint(card, checkpoint);
        card.updatedAt = checkpoint.createdAt;
    }
    if (checkpoint.kind === "decision_made" && !hasDecision(board, checkpoint.idempotencyKey)) {
        board.decisions = [
            {
                id: `decision-${checkpoint.idempotencyKey}`,
                title: checkpoint.summary.slice(0, 140),
                decision: checkpoint.summary,
                reason: content === "" ? "Recorded by Relay integration." : content,
                status: "Accepted",
            },
            ...(board.decisions ?? []),
        ];
    }
    updatePhaseTimeline(board, checkpoint, card);
    updateBoardMetrics(board);
    board.lastActivity = checkpoint.createdAt;
    writeWorkspace(workspacePath, workspace);
    return { updated: true };
}
export function checkpointFromSessionEndInput(input, agent, boardId) {
    const record = isRecord(input) ? input : {};
    const createdAt = new Date().toISOString();
    const summary = firstString(record, ["summary", "message", "lastResponse", "transcriptSummary", "prompt"]) ?? `${agentDisplayName(agent)} session ended`;
    const repositoryRoot = firstString(record, ["repositoryRoot", "repoRoot", "cwd", "workspace"]) ?? process.cwd();
    const sessionId = firstString(record, ["sessionId", "session_id", "id"]) ?? `session-${createdAt}`;
    const filesChanged = stringArray(record.filesChanged).concat(stringArray(record.changedFiles)).slice(0, 30);
    const commandsRun = stringArray(record.commandsRun).concat(stringArray(record.commands)).slice(0, 20);
    const remainingWork = stringArray(record.remainingWork).concat(stringArray(record.todos)).slice(0, 20);
    const knownIssues = stringArray(record.knownIssues).concat(stringArray(record.errors)).slice(0, 20);
    return {
        boardId,
        agent,
        sessionId,
        repository: {
            root: repositoryRoot,
            workingDirectory: firstString(record, ["workingDirectory", "cwd"]) ?? repositoryRoot,
            dirty: filesChanged.length > 0,
            changedFiles: filesChanged,
            stagedFiles: stringArray(record.stagedFiles),
        },
        kind: knownIssues.length > 0 ? "blocker_discovered" : filesChanged.length > 0 ? "files_changed" : "session_end",
        summary: summary.slice(0, 180),
        filesChanged,
        commandsRun,
        tests: [],
        knownIssues,
        remainingWork,
        idempotencyKey: firstString(record, ["idempotencyKey", "idempotency_key"]) ?? `${agent}-${sessionId}-${createdAt}-${randomUUID()}`,
        createdAt,
    };
}
function updateCardFromCheckpoint(card, checkpoint) {
    if (checkpoint.kind === "card_started" || checkpoint.kind === "implementation_step" || checkpoint.kind === "files_changed") {
        card.columnId = "progress";
        card.progress = Math.max(numberOrZero(card.progress), checkpoint.kind === "card_started" ? 5 : 25);
    }
    if (checkpoint.kind === "tests_run" || checkpoint.kind === "tests_failed" || checkpoint.kind === "tests_passed") {
        card.columnId = checkpoint.kind === "tests_passed" ? "review" : "progress";
        card.progress = Math.max(numberOrZero(card.progress), checkpoint.kind === "tests_passed" ? 80 : 50);
    }
    if (checkpoint.kind === "blocker_discovered" || checkpoint.kind === "tests_failed") {
        card.blocked = true;
    }
    if (checkpoint.kind === "card_completed") {
        card.columnId = "verified";
        card.progress = 100;
        card.blocked = false;
        card.criteriaDone = Math.max(numberOrZero(card.criteriaDone), numberOrZero(card.criteriaTotal));
    }
}
function updatePhaseTimeline(board, checkpoint, card) {
    if (!Array.isArray(board.phases) || board.phases.length === 0)
        return;
    const phase = card?.phaseId === undefined
        ? board.phases[0]
        : board.phases.find((item) => item.id === card.phaseId) ?? board.phases[0];
    if (phase === undefined)
        return;
    const relatedCards = (board.cards ?? []).filter((item) => item.phaseId === phase.id);
    const phaseProgress = relatedCards.length === 0
        ? checkpoint.kind === "card_completed" ? 100 : Math.max(numberOrZero(phase.progress), checkpoint.kind === "card_started" ? 5 : 0)
        : averageProgress(relatedCards);
    phase.progress = clampPercent(phaseProgress);
    phase.status = phase.progress >= 100 ? "complete" : phase.progress > 0 ? "in_progress" : "planned";
    board.currentPhase = board.phases.find((item) => item.status === "in_progress")?.name
        ?? board.phases.find((item) => item.status === "planned")?.name
        ?? phase.name;
}
function updateBoardMetrics(board) {
    const cards = board.cards ?? [];
    board.activeTasks = cards.filter((card) => card.columnId !== "verified").length;
    board.blockers = cards.filter((card) => card.blocked === true).length;
    board.progress = cards.length === 0 ? numberOrZero(board.progress) : averageProgress(cards);
}
function hasDecision(board, idempotencyKey) {
    return (board.decisions ?? []).some((item) => item.id === `decision-${idempotencyKey}`);
}
function averageProgress(cards) {
    if (cards.length === 0)
        return 0;
    return Math.round(cards.reduce((sum, card) => sum + clampPercent(numberOrZero(card.progress)), 0) / cards.length);
}
function clampPercent(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
}
function numberOrZero(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function writeWorkspace(path, workspace) {
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(workspace, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, path);
}
function agentDisplayName(agent) {
    if (agent === "claude-code")
        return "Claude";
    if (agent === "codex")
        return "Codex";
    return "Relay Agent";
}
function agentActorKind(agent) {
    if (agent === "claude-code")
        return "claude";
    if (agent === "codex")
        return "codex";
    return "agent";
}
function activityAction(kind) {
    if (kind === "decision_made")
        return "recorded decision";
    if (kind === "blocker_discovered" || kind === "tests_failed")
        return "flagged";
    if (kind === "tests_passed" || kind === "card_completed")
        return "verified";
    if (kind === "files_changed")
        return "changed files for";
    return "checkpointed";
}
function activityTone(kind) {
    if (kind === "blocker_discovered" || kind === "tests_failed")
        return "orange";
    if (kind === "decision_made" || kind === "tests_passed" || kind === "card_completed")
        return "green";
    if (kind === "handoff" || kind === "session_end")
        return "violet";
    return "blue";
}
function contextCategory(kind) {
    if (kind === "decision_made")
        return "Decision";
    if (kind === "blocker_discovered" || kind === "tests_failed")
        return "Warning";
    if (kind === "files_changed")
        return "Important file";
    return "Current state";
}
function contextTitle(checkpoint) {
    if (checkpoint.kind === "files_changed" && checkpoint.filesChanged[0] !== undefined)
        return `Changed ${checkpoint.filesChanged[0]}`;
    return checkpoint.summary.slice(0, 90);
}
function checkpointContent(checkpoint) {
    const parts = [
        checkpoint.summary,
        checkpoint.filesChanged.length > 0 ? `Files: ${checkpoint.filesChanged.join(", ")}` : "",
        checkpoint.commandsRun.length > 0 ? `Commands: ${checkpoint.commandsRun.join("; ")}` : "",
        checkpoint.tests.length > 0 ? `Tests: ${checkpoint.tests.map((test) => `${test.command} ${test.status}: ${test.summary}`).join("; ")}` : "",
        checkpoint.knownIssues.length > 0 ? `Issues: ${checkpoint.knownIssues.join("; ")}` : "",
        checkpoint.remainingWork.length > 0 ? `Remaining: ${checkpoint.remainingWork.join("; ")}` : "",
        checkpoint.recommendedNextTask === undefined ? "" : `Next: ${checkpoint.recommendedNextTask}`,
    ].filter(Boolean);
    return parts.join("\n");
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function firstString(record, keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim() !== "")
            return value.trim();
    }
    return undefined;
}
function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];
}

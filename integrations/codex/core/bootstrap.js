import { defaultConfigPath, loadIntegrationConfig } from "./config.js";
import { readLocalQueue } from "./local-queue.js";
import { relayPluginProtocolVersion } from "./protocol.js";
import { detectRepositoryIdentity } from "./repository.js";
export function buildSessionBootstrap(options) {
    const repository = detectRepositoryIdentity(options.cwd);
    const config = loadIntegrationConfig(options.configPath ?? defaultConfigPath());
    const repositoryLink = config.repositories[repository.root];
    const pendingLocalUpdates = options.queuePath === undefined
        ? 0
        : readLocalQueue(options.queuePath).checkpoints.length;
    if (!config.enabled) {
        return {
            protocolVersion: relayPluginProtocolVersion,
            enabled: false,
            sourceAgent: options.agent,
            repository,
            syncState: "disabled",
            pendingLocalUpdates,
            compactReminder: "Relay disabled. Do not use board state unless user enables it.",
        };
    }
    if (repositoryLink === undefined || !repositoryLink.enabled) {
        return {
            protocolVersion: relayPluginProtocolVersion,
            enabled: true,
            sourceAgent: options.agent,
            repository,
            syncState: "unlinked",
            pendingLocalUpdates,
            compactReminder: "Relay enabled but repo unlinked. Track only obvious long tasks after board creation/link.",
        };
    }
    return {
        protocolVersion: relayPluginProtocolVersion,
        enabled: true,
        sourceAgent: options.agent,
        repository,
        connectedBoard: {
            boardId: repositoryLink.boardId,
            boardVersion: 0,
            name: "Linked Relay board",
            objective: "Fetch focused board summary through Relay API or MCP before long-running work.",
            blockers: [],
            recentDecisions: [],
            recommendedNextAction: "Run Relay board summary retrieval, verify Git state, then continue active card.",
            updatedAt: new Date(0).toISOString(),
        },
        syncState: pendingLocalUpdates > 0 ? "pending" : "synced",
        pendingLocalUpdates,
        compactReminder: `Relay board ${repositoryLink.boardId} is persistent source of truth. Checkpoint meaningful progress before switching cards, compaction, or session end.`,
    };
}

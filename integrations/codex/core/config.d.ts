export interface RelayIntegrationConfig {
    apiBaseUrl?: string;
    enabled: boolean;
    localWorkspacePath?: string;
    localOnly: boolean;
    repositories: Record<string, {
        boardId: string;
        enabled: boolean;
    }>;
    uploadSourceSnippets: boolean;
    storeRawTranscripts: boolean;
    automaticBoardCreation: "ask" | "off" | "on";
    checkpointFrequency: "manual" | "meaningful_steps";
}
export declare const defaultRelayIntegrationConfig: RelayIntegrationConfig;
export declare function defaultConfigPath(): string;
export declare function loadIntegrationConfig(path?: string): RelayIntegrationConfig;
export declare function saveIntegrationConfig(config: RelayIntegrationConfig, path?: string): void;
//# sourceMappingURL=config.d.ts.map
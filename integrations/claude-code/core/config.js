import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
export const defaultRelayIntegrationConfig = {
    enabled: true,
    localOnly: false,
    repositories: {},
    uploadSourceSnippets: false,
    storeRawTranscripts: false,
    automaticBoardCreation: "ask",
    checkpointFrequency: "meaningful_steps",
};
export function defaultConfigPath() {
    return join(homedir(), ".relay", "integrations", "config.json");
}
export function loadIntegrationConfig(path = defaultConfigPath()) {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        return {
            ...defaultRelayIntegrationConfig,
            ...parsed,
            repositories: parsed.repositories ?? {},
        };
    }
    catch {
        return defaultRelayIntegrationConfig;
    }
}
export function saveIntegrationConfig(config, path = defaultConfigPath()) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

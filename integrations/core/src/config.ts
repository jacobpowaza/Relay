import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface RelayIntegrationConfig {
  apiBaseUrl?: string;
  enabled: boolean;
  localWorkspacePath?: string;
  localOnly: boolean;
  repositories: Record<string, { boardId: string; enabled: boolean }>;
  uploadSourceSnippets: boolean;
  storeRawTranscripts: boolean;
  automaticBoardCreation: "ask" | "off" | "on";
  checkpointFrequency: "manual" | "meaningful_steps";
}

export const defaultRelayIntegrationConfig: RelayIntegrationConfig = {
  enabled: true,
  localOnly: false,
  repositories: {},
  uploadSourceSnippets: false,
  storeRawTranscripts: false,
  automaticBoardCreation: "ask",
  checkpointFrequency: "meaningful_steps",
};

export function defaultConfigPath(): string {
  return join(homedir(), ".relay", "integrations", "config.json");
}

export function loadIntegrationConfig(path = defaultConfigPath()): RelayIntegrationConfig {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RelayIntegrationConfig>;
    return {
      ...defaultRelayIntegrationConfig,
      ...parsed,
      repositories: parsed.repositories ?? {},
    };
  } catch {
    return defaultRelayIntegrationConfig;
  }
}

export function saveIntegrationConfig(config: RelayIntegrationConfig, path = defaultConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

import type { RelayWorkspaceData } from "./types";

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

export interface RelayIntegrationConfigResult {
  config: RelayIntegrationConfig;
  configPath: string;
  exists: boolean;
}

export type RelayUpdateChannel = "stable" | "prerelease";
export type RelayCloseAction = "hide" | "quit";

export interface RelayUpdateSettings {
  autoCheck: boolean;
  autoDownload: boolean;
  channel: RelayUpdateChannel;
  skippedVersion: string | null;
  dismissedVersion: string | null;
  lastCheckAt: string | null;
}

export interface RelayBackgroundSettings {
  runInBackground: boolean;
  launchAtLogin: boolean;
  keepAliveOnClose: boolean;
  closeAction: RelayCloseAction;
}

export interface RelayAppSettings {
  version: 1;
  updates: RelayUpdateSettings;
  background: RelayBackgroundSettings;
}

export interface RelayBackgroundStatus {
  runInBackground: boolean;
  keepAliveOnClose: boolean;
  closeAction: RelayCloseAction;
  launchAtLogin: boolean;
  resident: boolean;
}

export interface RelayAppSettingsResult {
  settings: RelayAppSettings;
  backgroundStatus: RelayBackgroundStatus;
}

export type RelayUpdatePhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "failed";

export interface RelayUpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export interface RelayUpdateState {
  phase: RelayUpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  releaseUrl: string | null;
  progress: RelayUpdateProgress | null;
  error: string | null;
  lastCheckAt: string | null;
  channel: RelayUpdateChannel;
  target: { platform: string; arch: string; label: string };
  skippedVersion: string | null;
  dismissedVersion: string | null;
  checkedManually: boolean;
  supported: boolean;
  note: string | null;
}

export interface RelayDiagnosticsSnapshot {
  enabled: true;
  capturedAt: string;
  uptimeSeconds: number;
  main: { cpuPercent: number; memoryMB: number; heapUsedMB: number };
  activeTimers: number;
  activeWatchers: number;
  childProcesses: number;
  windows: number;
  gitRefreshesPerMinute: number;
  updateChecksPerMinute: number;
}

export interface RelayGitRisk {
  level: "artifact" | "secret";
  reason: string;
}

export interface RelayGitFileChange {
  additions: number;
  binary: boolean;
  deletions: number;
  kind: "conflicted" | "modified" | "staged" | "staged_modified" | "untracked";
  modifiedStatus?: string;
  originalPath?: string;
  patch: string;
  path: string;
  reviewable: boolean;
  reviewError?: string;
  risks: RelayGitRisk[];
  stagedStatus?: string;
  state: "added" | "conflicted" | "deleted" | "modified" | "renamed" | "untracked";
  tracked: boolean;
}

export interface RelayGitCommit {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
  body: string;
  refs: string[];
}

export interface RelayGitComparison {
  base: string;
  head: string;
  files: Array<Pick<RelayGitFileChange, "additions" | "binary" | "deletions" | "originalPath" | "patch" | "path" | "reviewable" | "risks" | "state">>;
}

export interface RelayGitStatus {
  branch: string | null;
  canPush: boolean;
  files: RelayGitFileChange[];
  head: string | null;
  pushUnavailableReason: string | null;
  remote: string | null;
  remoteUrl: string | null;
  repositoryRoot: string;
  snapshotId: string;
}

export interface RelayGitPreparedPlan {
  branch: string | null;
  canPush: boolean;
  commits: Array<{
    id: string;
    message: string;
    files: Array<Pick<RelayGitFileChange, "additions" | "deletions" | "kind" | "path" | "risks">>;
    commands: string[];
  }>;
  confirmationToken: string;
  expiresAt: string;
  head: string | null;
  remote: string | null;
  remoteUrl: string | null;
  repositoryRoot: string;
}

export interface RelayGitExecutionResult {
  branch: string | null;
  commands: string[];
  commits: Array<{ files: string[]; hash: string; message: string }>;
  errors: string[];
  push: { output: string; success: boolean } | null;
  remote: string | null;
  remoteUrl: string | null;
  success: boolean;
  warnings: string[];
}

interface RelayDesktopApi {
  chooseDirectory: () => Promise<{ name: string; path: string } | null>;
  getIntegrationConfig: () => Promise<RelayIntegrationConfigResult>;
  setIntegrationConfig: (update: Partial<RelayIntegrationConfig>) => Promise<RelayIntegrationConfigResult>;
  getStorageInfo: () => Promise<{ dataFilePath: string }>;
  openStorageLocation: () => Promise<{ opened: true }>;
  openPath: (path: string) => Promise<{ opened: boolean; error?: string }>;
  openPathInTerminal: (path: string) => Promise<{ opened: boolean; error?: string }>;
  copyText: (text: string) => Promise<{ copied: boolean }>;
  moveDirectoryToTrash: (path: string) => Promise<{ trashed: boolean; error?: string }>;
  getGitStatus: (input: { boardId: string }) => Promise<RelayGitStatus>;
  getGitDiff: (input: { boardId: string; path: string }) => Promise<RelayGitFileChange>;
  getGitHistory: (input: { boardId: string; limit?: number }) => Promise<RelayGitCommit[]>;
  compareGitCommits: (input: { boardId: string; base: string; head: string }) => Promise<RelayGitComparison>;
  getGitCommitDiff: (input: { boardId: string; base: string; head: string; path: string }) => Promise<Pick<RelayGitFileChange, "additions" | "binary" | "deletions" | "patch" | "path" | "reviewable" | "risks">>;
  prepareGitCommits: (input: {
    acknowledgedRiskPaths: string[];
    boardId: string;
    commits: Array<{ id: string; message: string; paths: string[] }>;
    snapshotId: string;
  }) => Promise<RelayGitPreparedPlan>;
  executeGitCommits: (input: { confirmationToken: string; push: boolean }) => Promise<RelayGitExecutionResult>;
  pushGitBranch: (input: { boardId: string }) => Promise<RelayGitExecutionResult>;
  loadWorkspace: () => Promise<RelayWorkspaceData>;
  onWorkspaceChanged: (callback: (workspace: RelayWorkspaceData) => void) => () => void;
  saveWorkspace: (workspace: RelayWorkspaceData) => Promise<RelayWorkspaceData>;
  getAppSettings: () => Promise<RelayAppSettingsResult>;
  setAppSettings: (patch: { updates?: Partial<RelayUpdateSettings>; background?: Partial<RelayBackgroundSettings> }) => Promise<RelayAppSettingsResult>;
  getUpdateState: () => Promise<RelayUpdateState>;
  checkForUpdates: (input?: { manual?: boolean }) => Promise<RelayUpdateState>;
  downloadUpdate: () => Promise<RelayUpdateState>;
  installUpdate: () => Promise<{ installed: boolean; reason?: string }>;
  skipUpdateVersion: (version: string) => Promise<RelayUpdateState>;
  dismissUpdateVersion: (version: string) => Promise<RelayUpdateState>;
  onUpdateState: (callback: (state: RelayUpdateState) => void) => () => void;
  getDiagnostics: () => Promise<RelayDiagnosticsSnapshot | null>;
}

declare global {
  interface Window {
    relayDesktop?: RelayDesktopApi;
  }
}

export {};

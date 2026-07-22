import type {
  DiscoveryEstimate,
  RelayAppSettingsResult,
  RelayBackgroundSettings,
  RelayDiagnosticsSnapshot,
  RelayIntegrationConfig,
  RelayIntegrationConfigResult,
  RelayUpdateSettings,
  RelayUpdateState,
} from "./desktop";
import type { ActivityRecord, CardNote, DiscoveryIndex, RelayBoard, RelayCard, RelayTag, RelayTagTone, RelayWorkspaceData } from "./types";

export const defaultRelaySettings: Required<RelayWorkspaceData>["settings"] = {
  displayName: "Local User",
  defaultView: "board",
  appearance: "light",
  density: "comfortable",
  performanceMode: false,
  reduceMotion: false,
  compactCards: false,
  showStoragePath: true,
  activityLimit: 4,
  boardColumnWidth: 240,
};

const emptyWorkspace: RelayWorkspaceData = { directories: [], boards: [], tags: [], settings: defaultRelaySettings };
const tagTones: RelayTagTone[] = ["blue", "green", "orange", "violet", "coral", "gray"];
const workspaceLoadTimeoutMilliseconds = 8000;
let currentWorkspace = normalizeWorkspace(emptyWorkspace);
let workspaceInitialization: Promise<void> | null = null;
let workspaceSaveQueue: Promise<void> = Promise.resolve();
let desktopWorkspaceUnsubscribe: (() => void) | null = null;
const listeners = new Set<() => void>();
const saveErrorListeners = new Set<(message: string) => void>();

async function withWorkspaceLoadTimeout(workspace: Promise<RelayWorkspaceData>): Promise<RelayWorkspaceData> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      workspace,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => {
          reject(new Error("Timed out while opening the local Relay workspace."));
        }, workspaceLoadTimeoutMilliseconds);
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

export async function initializeWorkspaceStore(): Promise<void> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) return;

  if (workspaceInitialization === null) {
    workspaceInitialization = withWorkspaceLoadTimeout(window.relayDesktop.loadWorkspace())
      .then((workspace) => {
        currentWorkspace = normalizeWorkspace(workspace);
        subscribeToDesktopWorkspaceChanges();
        listeners.forEach((listener) => listener());
      })
      .catch((error: unknown) => {
        workspaceInitialization = null;
        throw error;
      });
  }

  return workspaceInitialization;
}

/**
 * Reuses references from `previous` for any part of `next` that is deeply
 * equal, so an external change produces new object identities only along the
 * paths that actually changed.
 *
 * Without this, normalizeWorkspace rebuilds the whole graph on every write and
 * useSyncExternalStore hands React an all-new tree: every card re-renders,
 * identity-keyed components remount, and transient UI state (open modals,
 * scroll position, in-flight edits) is discarded. That is the "app blanks out
 * on any change" behavior.
 *
 * Arrays of entities are matched by `id` rather than index so that inserting
 * or reordering a card does not invalidate its siblings.
 */
export function reconcile<T>(previous: T, next: T): T {
  if (previous === next) return previous;
  if (previous === null || next === null || typeof previous !== "object" || typeof next !== "object") {
    return next;
  }

  if (Array.isArray(previous) && Array.isArray(next)) {
    const previousById = new Map<string, unknown>();
    for (const item of previous) {
      const id = (item as { id?: unknown })?.id;
      if (typeof id === "string") previousById.set(id, item);
    }

    let identical = previous.length === next.length;
    const merged: unknown[] = next.map((item, index) => {
      const id = (item as { id?: unknown })?.id;
      const candidate: unknown = typeof id === "string" && previousById.has(id)
        ? previousById.get(id)
        : previous[index];
      const reconciled: unknown = candidate === undefined ? item : reconcile(candidate, item);
      if (reconciled !== previous[index]) identical = false;
      return reconciled;
    });
    return (identical ? previous : merged) as T;
  }

  if (Array.isArray(previous) !== Array.isArray(next)) return next;

  const previousRecord = previous as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  const nextKeys = Object.keys(nextRecord);
  let identical = nextKeys.length === Object.keys(previousRecord).length;
  const merged: Record<string, unknown> = {};

  for (const key of nextKeys) {
    const reconciled = key in previousRecord
      ? reconcile(previousRecord[key], nextRecord[key])
      : nextRecord[key];
    merged[key] = reconciled;
    if (reconciled !== previousRecord[key]) identical = false;
  }

  return (identical ? previous : merged) as T;
}

function subscribeToDesktopWorkspaceChanges(): void {
  if (typeof window === "undefined" || window.relayDesktop === undefined || desktopWorkspaceUnsubscribe !== null) return;
  desktopWorkspaceUnsubscribe = window.relayDesktop.onWorkspaceChanged((workspace) => {
    const nextWorkspace = reconcile(currentWorkspace, normalizeWorkspace(workspace));
    // reconcile returns the previous reference outright when nothing changed,
    // which makes this identity check exact rather than a JSON comparison.
    if (nextWorkspace === currentWorkspace) return;
    currentWorkspace = nextWorkspace;
    listeners.forEach((listener) => listener());
  });
}

export async function getLocalStorageInfo(): Promise<{ dataFilePath: string } | null> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) return null;
  return window.relayDesktop.getStorageInfo();
}

export async function openLocalStorageLocation(): Promise<boolean> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) return false;
  await window.relayDesktop.openStorageLocation();
  return true;
}

export async function chooseWorkspaceDirectory(): Promise<{ name: string; path: string } | null> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) return null;
  return window.relayDesktop.chooseDirectory();
}

export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && window.relayDesktop !== undefined;
}

export async function getIntegrationConfig(): Promise<RelayIntegrationConfigResult | null> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) return null;
  return window.relayDesktop.getIntegrationConfig();
}

export async function setIntegrationConfig(
  update: Partial<RelayIntegrationConfig>,
): Promise<RelayIntegrationConfigResult | null> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) return null;
  return window.relayDesktop.setIntegrationConfig(update);
}

export async function getAppSettings(): Promise<RelayAppSettingsResult | null> {
  if (typeof window === "undefined" || window.relayDesktop?.getAppSettings === undefined) return null;
  return window.relayDesktop.getAppSettings();
}

export async function setAppSettings(
  patch: { updates?: Partial<RelayUpdateSettings>; background?: Partial<RelayBackgroundSettings> },
): Promise<RelayAppSettingsResult | null> {
  if (typeof window === "undefined" || window.relayDesktop?.setAppSettings === undefined) return null;
  return window.relayDesktop.setAppSettings(patch);
}

export async function getUpdateState(): Promise<RelayUpdateState | null> {
  if (typeof window === "undefined" || window.relayDesktop?.getUpdateState === undefined) return null;
  return window.relayDesktop.getUpdateState();
}

export async function checkForUpdates(input?: { manual?: boolean }): Promise<RelayUpdateState | null> {
  if (typeof window === "undefined" || window.relayDesktop?.checkForUpdates === undefined) return null;
  return window.relayDesktop.checkForUpdates(input);
}

export async function downloadUpdate(): Promise<RelayUpdateState | null> {
  if (typeof window === "undefined" || window.relayDesktop?.downloadUpdate === undefined) return null;
  return window.relayDesktop.downloadUpdate();
}

export async function installUpdate(): Promise<{ installed: boolean; reason?: string } | null> {
  if (typeof window === "undefined" || window.relayDesktop?.installUpdate === undefined) return null;
  return window.relayDesktop.installUpdate();
}

export async function skipUpdateVersion(version: string): Promise<RelayUpdateState | null> {
  if (typeof window === "undefined" || window.relayDesktop?.skipUpdateVersion === undefined) return null;
  return window.relayDesktop.skipUpdateVersion(version);
}

export async function dismissUpdateVersion(version: string): Promise<RelayUpdateState | null> {
  if (typeof window === "undefined" || window.relayDesktop?.dismissUpdateVersion === undefined) return null;
  return window.relayDesktop.dismissUpdateVersion(version);
}

export function subscribeUpdateState(callback: (state: RelayUpdateState) => void): () => void {
  if (typeof window === "undefined" || window.relayDesktop?.onUpdateState === undefined) return () => undefined;
  return window.relayDesktop.onUpdateState(callback);
}

export async function getDiagnostics(): Promise<RelayDiagnosticsSnapshot | null> {
  if (typeof window === "undefined" || window.relayDesktop?.getDiagnostics === undefined) return null;
  return window.relayDesktop.getDiagnostics();
}

export async function openDirectoryPath(path: string): Promise<{ opened: boolean; error?: string }> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) {
    return { opened: false, error: "Only available in the Relay desktop app." };
  }
  return window.relayDesktop.openPath(path);
}

export async function openDirectoryInTerminal(path: string): Promise<{ opened: boolean; error?: string }> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) {
    return { opened: false, error: "Only available in the Relay desktop app." };
  }
  return window.relayDesktop.openPathInTerminal(path);
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window !== "undefined" && window.relayDesktop !== undefined) {
    try {
      await window.relayDesktop.copyText(text);
      return true;
    } catch {
      return false;
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function moveDirectoryToTrash(path: string): Promise<{ trashed: boolean; error?: string }> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) {
    return { trashed: false, error: "Only available in the Relay desktop app." };
  }
  return window.relayDesktop.moveDirectoryToTrash(path);
}

export function getWorkspaceSnapshot(): RelayWorkspaceData {
  return currentWorkspace;
}

export function getServerWorkspaceSnapshot(): RelayWorkspaceData {
  return emptyWorkspace;
}

export function subscribeWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setWorkspace(
  value: RelayWorkspaceData | ((current: RelayWorkspaceData) => RelayWorkspaceData),
): void {
  const normalized = normalizeWorkspace(typeof value === "function" ? value(currentWorkspace) : value);
  // Same structural sharing as the external-change path: a local edit to one
  // card must not hand React a brand-new identity for every other card.
  const nextWorkspace = reconcile(currentWorkspace, normalized);
  // Identity is unchanged only when nothing actually changed. The save still
  // runs either way, so a caller writing identical data to force persistence
  // keeps working; only the re-render is skipped.
  const changed = nextWorkspace !== currentWorkspace;
  currentWorkspace = nextWorkspace;
  if (typeof window !== "undefined" && window.relayDesktop !== undefined) {
    const workspaceToSave = currentWorkspace;
    const save = workspaceSaveQueue
      .catch(() => undefined)
      .then(async () => {
        await window.relayDesktop?.saveWorkspace(workspaceToSave);
      });
    workspaceSaveQueue = save;
    void save.catch((error: unknown) => {
      console.error("Relay could not save the local workspace.", error);
      const message = error instanceof Error ? error.message : "Relay could not save the local workspace.";
      saveErrorListeners.forEach((listener) => listener(message));
    });
  }
  if (changed) listeners.forEach((listener) => listener());
}

export function subscribeWorkspaceSaveErrors(listener: (message: string) => void): () => void {
  saveErrorListeners.add(listener);
  return () => saveErrorListeners.delete(listener);
}

function normalizeWorkspace(workspace: RelayWorkspaceData): RelayWorkspaceData {
  const discoveries: Record<string, DiscoveryIndex> = { ...(workspace.discoveries ?? {}) };
  let migrated = false;

  const boards = workspace.boards.map((board) => {
    const boardAny = board as unknown as Record<string, unknown>;
    const boardDiscovery = boardAny.discovery as DiscoveryIndex | undefined;
    if (boardDiscovery !== undefined) {
      const repoPath = boardAny.repository as string;
      if (repoPath && repoPath !== "No repository") {
        boardDiscovery.repoPath = repoPath;
        // Must match discoveryKey() in the main process, or the migrated index
        // lands under a key the backend never looks up and the repo rescans.
        discoveries[repoPath.replace(/\/+$/, "").toLowerCase()] = boardDiscovery;
      }
      migrated = true;
    }
    const result: RelayBoard = {
      id: board.id,
      archivedAt: board.archivedAt,
      directoryId: board.directoryId,
      name: board.name,
      description: safeString(board.description),
      repository: safeString(board.repository) || "No repository",
      currentPhase: safeString(board.currentPhase) || "Planning",
      progress: percent(board.progress),
      activeTasks: wholeNumber(board.activeTasks),
      blockers: wholeNumber(board.blockers),
      lastActivity: safeDate(board.lastActivity),
      owner: safeString(board.owner) || "Unassigned",
      plan: safeString(board.plan),
      columns: board.columns ?? [],
      cards: (board.cards ?? []).map(normalizeCard),
      phases: (board.phases ?? []).map((phase) => ({
        ...phase,
        name: safeString(phase.name) || "Ungrouped",
        objective: safeString(phase.objective),
        progress: percent(phase.progress),
        status: phase.status === "complete" || phase.status === "in_progress" || phase.status === "planned" ? phase.status : "planned",
      })),
      context: board.context ?? [],
      activity: (board.activity ?? []).map(normalizeActivity),
      decisions: board.decisions ?? [],
    };
    return result;
  });

  return {
    ...workspace,
    boards,
    tags: normalizeTags(workspace.tags ?? [], boards),
    settings: { ...defaultRelaySettings, ...(workspace.settings ?? {}) },
    discoveries: migrated ? discoveries : (workspace.discoveries ?? undefined),
  } as RelayWorkspaceData;
}

function normalizeCard(card: RelayCard): RelayCard {
  const seenNoteIds = new Set<string>();
  return {
    ...card,
    ...(card.archivedAt === undefined ? {} : { archivedAt: safeDate(card.archivedAt) }),
    title: safeString(card.title) || "Untitled card",
    description: safeString(card.description),
    columnId: safeString(card.columnId) || "backlog",
    phaseId: safeString(card.phaseId) || "unphased",
    type: card.type ?? "task",
    priority: card.priority ?? "normal",
    tags: [...new Set((card.tags ?? []).map(cleanTagName).filter(Boolean))],
    notes: (card.notes ?? []).map((note, index) => normalizeNote(note, index, seenNoteIds)),
    progress: percent(card.progress),
    criteriaDone: wholeNumber(card.criteriaDone),
    criteriaTotal: wholeNumber(card.criteriaTotal),
    blocked: card.blocked === true,
    owner: safeString(card.owner) || "Unassigned",
    updatedAt: safeDate(card.updatedAt),
  };
}

function normalizeNote(note: CardNote, index: number, seenNoteIds: Set<string>): CardNote {
  const createdAt = typeof note.createdAt === "string" && note.createdAt.trim() !== "" ? note.createdAt : new Date(0).toISOString();
  const rawId = typeof note.id === "string" ? note.id.trim() : "";
  const stableFallback = `note-${createdAt}-${index}`;
  const baseId = rawId === "" ? stableFallback : rawId;
  const id = seenNoteIds.has(baseId) ? `${baseId}-${index}` : baseId;
  seenNoteIds.add(id);
  return {
    id,
    body: typeof note.body === "string" ? note.body : "",
    author: typeof note.author === "string" && note.author.trim() !== "" ? note.author : "Unknown",
    createdAt,
  };
}

function normalizeTags(existingTags: RelayTag[], boards: RelayWorkspaceData["boards"]): RelayTag[] {
  const tagsByName = new Map<string, RelayTag>();
  for (const tag of existingTags) {
    const name = cleanTagName(tag.name);
    if (name !== "") tagsByName.set(name.toLowerCase(), { name, tone: tagTones.includes(tag.tone) ? tag.tone : toneForTag(name) });
  }
  for (const board of boards) {
    for (const card of board.cards) {
      for (const rawTag of card.tags ?? []) {
        const name = cleanTagName(rawTag);
        if (name !== "" && !tagsByName.has(name.toLowerCase())) tagsByName.set(name.toLowerCase(), { name, tone: toneForTag(name) });
      }
    }
  }
  return [...tagsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function cleanTagName(value: string): string {
  return value.trim().replace(/^#/, "").replace(/\s+/g, "-").slice(0, 32);
}

function toneForTag(name: string): RelayTagTone {
  let hash = 0;
  for (const character of name.toLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return tagTones[hash % tagTones.length] ?? "gray";
}

// --- discovery --------------------------------------------------------------------

export async function startDiscovery(
  repoPath: string,
  options: { force?: boolean; discoveredBy?: string } = {},
): Promise<DiscoveryIndex | null> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) return null;
  const input: { repoPath: string; force?: boolean; discoveredBy?: string } = { repoPath };
  if (options.force !== undefined) input.force = options.force;
  if (options.discoveredBy !== undefined) input.discoveredBy = options.discoveredBy;
  return window.relayDesktop.startDiscovery(input);
}

/** Stored index with status derived against current disk state. */
export async function getDiscovery(repoPath: string): Promise<DiscoveryIndex | null> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) return null;
  return window.relayDesktop.getDiscovery({ repoPath });
}

export async function getDiscoveryDiff(repoPath: string): Promise<unknown> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) return null;
  return window.relayDesktop.getDiscoveryDiff({ repoPath });
}

export async function getDiscoveryAgents(): Promise<Array<{ id: string; label: string; models: Array<{ id: string; label: string }>; defaultModel: string }>> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) return [];
  return window.relayDesktop.getDiscoveryAgents();
}

/** Hybrid step: heuristics already indexed the repo, this upgrades purposes. */
export async function enrichDiscovery(input: {
  repoPath: string;
  agent: string;
  model?: string;
  filePaths?: string[];
  limit?: number;
}): Promise<(DiscoveryIndex & { enriched: number; failed: string[]; error?: string; alreadyComplete?: boolean }) | null> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) return null;
  return window.relayDesktop.enrichDiscovery(input);
}

/** Prices a run before it starts. Null outside the desktop shell, where no agent could be spawned anyway. */
export async function estimateDiscoveryEnrichment(input: {
  repoPath: string;
  agent: string;
  model?: string;
  filePaths?: string[];
  limit?: number;
}): Promise<DiscoveryEstimate | null> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) return null;
  return window.relayDesktop.estimateDiscoveryEnrichment(input);
}

export async function cancelDiscoveryEnrichment(repoPath: string): Promise<boolean> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) return false;
  const result = await window.relayDesktop.cancelDiscoveryEnrichment({ repoPath });
  return result.cancelled;
}

export function onDiscoveryProgress(
  callback: (progress: { repoPath: string; completed: number; total: number; phase: string }) => void,
): () => void {
  if (typeof window === "undefined" || window.relayDesktop === undefined) return () => {};
  return window.relayDesktop.onDiscoveryProgress(callback);
}

export async function updateDiscoveryFiles(
  repoPath: string,
  filePaths: string[],
  discoveredBy?: string,
): Promise<unknown> {
  if (typeof window === "undefined" || window.relayDesktop === undefined) return null;
  const input: { repoPath: string; filePaths: string[]; discoveredBy?: string } = { repoPath, filePaths };
  if (discoveredBy !== undefined) input.discoveredBy = discoveredBy;
  return window.relayDesktop.updateDiscoveryFiles(input);
}



function normalizeActivity(activity: ActivityRecord): ActivityRecord {
  const normalizedActivity = {
    ...activity,
    id: safeString(activity.id) || `activity-${safeDate(activity.time)}`,
    actor: safeString(activity.actor) || "Local User",
    action: safeString(activity.action) || "updated",
    target: safeString(activity.target) || "workspace",
    time: safeDate(activity.time),
    tone: activity.tone === "blue" || activity.tone === "green" || activity.tone === "orange" || activity.tone === "violet" ? activity.tone : "blue",
  };
  if (normalizedActivity.actorKind !== undefined) return normalizedActivity;

  const actor = normalizedActivity.actor.trim().toLowerCase();
  if (actor.includes("claude")) return { ...normalizedActivity, actorKind: "claude", actor: "Claude" };
  if (actor.includes("codex") || actor.includes("gpt") || actor.includes("openai")) {
    return { ...normalizedActivity, actorKind: "codex", actor: "Codex" };
  }
  return { ...normalizedActivity, actorKind: "human" };
}

function percent(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
}

function wholeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeDate(value: unknown): string {
  if (typeof value !== "string") return new Date(0).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : value;
}

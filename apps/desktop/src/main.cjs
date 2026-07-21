const path = require("node:path");

const { mkdirSync, watch } = require("node:fs");
const { mkdir, readFile, rename, writeFile } = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { homedir } = require("node:os");
const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } = require("electron");
const { autoUpdater } = require("electron-updater");

const {
  loadWorkspaceData,
  saveWorkspaceData,
  workspaceDataFilePath,
} = require("./workspace-storage.cjs");
const { createGitWorkflow } = require("./git-workflow.cjs");
const { canonicalizeRepositoryPath } = require("./canonical-path.cjs");
const platformService = require("./platform-service.cjs");
const semver = require("./semver.cjs");
const { loadAppSettings, saveAppSettings } = require("./app-settings.cjs");
const { createBackgroundService } = require("./background-service.cjs");
const { createTrayService } = require("./tray-service.cjs");
const { createUpdaterService } = require("./updater-service.cjs");
const { createDiagnosticsService } = require("./diagnostics-service.cjs");
const { buildEntry, discoverRepository, diffDiscovery, withDerivedStatus } = require("./discovery.cjs");
const { enrichEntries, listAgents } = require("./enrichment.cjs");

app.setName("Relay");

// Single-instance: a second launch focuses the running window rather than
// spawning a duplicate process (which would double watchers, timers and tray
// icons). If we don't get the lock, exit immediately.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

if (platformService.isMac && app.dock) {
  app.dock.setIcon(path.join(__dirname, "..", "build", "icon.png"));
}

if (process.env.RELAY_REMOTE_DEBUGGING_PORT !== undefined) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.RELAY_REMOTE_DEBUGGING_PORT);
}

const isDevelopment = !app.isPackaged;

function dataFilePath() {
  return workspaceDataFilePath(app.getPath("userData"));
}

/** @param {string} message @param {unknown} [error] */
function logMain(message, error) {
  if (isDevelopment) {
    if (error !== undefined) console.error(`[relay:main] ${message}`, error);
    else console.log(`[relay:main] ${message}`);
  }
}

// --- services ---------------------------------------------------------------------

const diagnostics = createDiagnosticsService({ enabled: isDevelopment });
const background = createBackgroundService({ app, platformService, log: logMain });

/** @type {ReturnType<typeof createTrayService> | null} */
let tray = null;
/** @type {ReturnType<typeof createUpdaterService> | null} */
let updater = null;

/** @type {import("node:fs").FSWatcher | null} */
let workspaceWatcher = null;
/** @type {NodeJS.Timeout | null} */
let workspaceWatchTimeout = null;
/** @type {string | null} */
let lastBroadcastWorkspace = null;
const gitWorkflow = createGitWorkflow();
const lightWindowBackground = "#f4f6f8";
const darkWindowBackground = "#0d1116";
/** @type {"dark" | "light" | "system"} */
let currentAppearance = "light";

diagnostics.registerGauge("windows", () => BrowserWindow.getAllWindows().length);
diagnostics.registerGauge("watchers", () => (workspaceWatcher === null ? 0 : 1));
diagnostics.registerGauge("timers", () => (workspaceWatchTimeout === null ? 0 : 1));
diagnostics.registerGauge("childProcesses", () => (typeof gitWorkflow.activeProcessCount === "function" ? gitWorkflow.activeProcessCount() : 0));

// --- appearance -------------------------------------------------------------------

/** @param {unknown} workspace @returns {"dark" | "light" | "system"} */
function appearanceFromWorkspace(workspace) {
  if (workspace === null || typeof workspace !== "object" || Array.isArray(workspace)) return "light";
  const settings = Reflect.get(workspace, "settings");
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return "light";
  const appearance = Reflect.get(settings, "appearance");
  return appearance === "dark" || appearance === "light" || appearance === "system" ? appearance : "light";
}

/** @param {"dark" | "light" | "system"} appearance */
function applyNativeAppearance(appearance) {
  currentAppearance = appearance;
  nativeTheme.themeSource = appearance;
  const backgroundColor = nativeTheme.shouldUseDarkColors ? darkWindowBackground : lightWindowBackground;
  for (const window of BrowserWindow.getAllWindows()) window.setBackgroundColor(backgroundColor);
}

async function getInitialAppearance() {
  try {
    return appearanceFromWorkspace(await loadWorkspaceData(dataFilePath()));
  } catch {
    return "light";
  }
}

async function loadWorkspace() {
  const workspace = await loadWorkspaceData(dataFilePath());
  applyNativeAppearance(appearanceFromWorkspace(workspace));
  return workspace;
}

/**
 * @param {import("electron").IpcMainInvokeEvent} _event
 * @param {unknown} value
 */
async function saveWorkspace(_event, value) {
  const workspace = await saveWorkspaceData(value, dataFilePath());
  applyNativeAppearance(appearanceFromWorkspace(workspace));
  lastBroadcastWorkspace = JSON.stringify(workspace);
  return workspace;
}

async function getStorageInfo() {
  return { dataFilePath: dataFilePath() };
}

// --- git board resolution ---------------------------------------------------------

/**
 * @param {unknown} boardId
 * @returns {Promise<string>}
 */
async function repositoryPathForBoard(boardId) {
  if (typeof boardId !== "string" || boardId.trim() === "") throw new Error("A board is required for this Git action.");
  const workspace = await loadWorkspace();
  const board = workspace.boards.find((candidate) => objectString(candidate, "id") === boardId);
  if (board === undefined) throw new Error("The requested board no longer exists.");
  const repository = objectString(board, "repository");
  if (repository !== null && path.isAbsolute(repository)) return canonicalizeRepositoryPath(repository).path;
  const directoryId = objectString(board, "directoryId");
  const directory = workspace.directories.find((candidate) => objectString(candidate, "id") === directoryId);
  const directoryPath = objectString(directory, "path");
  if (directoryPath !== null && path.isAbsolute(directoryPath)) return canonicalizeRepositoryPath(directoryPath).path;
  throw new Error("Link this board to a local project directory before using Git.");
}

/** @param {unknown} value @param {string} key @returns {string | null} */
function objectString(value, key) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = Reflect.get(value, key);
  return typeof candidate === "string" ? candidate : null;
}

/** @param {import("electron").IpcMainInvokeEvent} _event @param {unknown} input */
async function getGitStatus(_event, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input) || !("boardId" in input)) throw new Error("A board is required for this Git action.");
  diagnostics.recordEvent("gitRefresh");
  return gitWorkflow.status(await repositoryPathForBoard(input.boardId));
}

/** @param {import("electron").IpcMainInvokeEvent} _event @param {unknown} input */
async function getGitDiff(_event, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input) || !("boardId" in input) || !("path" in input)) throw new Error("A board and changed file are required for this Git action.");
  if (typeof input.path !== "string") throw new Error("Choose a changed file to review its diff.");
  return gitWorkflow.diff(await repositoryPathForBoard(input.boardId), input.path);
}

/** @param {import("electron").IpcMainInvokeEvent} _event @param {unknown} input */
async function getGitHistory(_event, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input) || !("boardId" in input)) throw new Error("A board is required for this Git action.");
  const limit = "limit" in input && typeof input.limit === "number" ? input.limit : 100;
  return gitWorkflow.history(await repositoryPathForBoard(input.boardId), limit);
}

/** @param {import("electron").IpcMainInvokeEvent} _event @param {unknown} input */
async function compareGitCommits(_event, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input) || !("boardId" in input) || !("base" in input) || !("head" in input)) throw new Error("Choose two commits to compare.");
  return gitWorkflow.compare(await repositoryPathForBoard(input.boardId), input.base, input.head);
}

/** @param {import("electron").IpcMainInvokeEvent} _event @param {unknown} input */
async function getGitCommitDiff(_event, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input) || !("boardId" in input) || !("base" in input) || !("head" in input) || !("path" in input)) throw new Error("Choose two commits and a changed file to review.");
  return gitWorkflow.compareDiff(await repositoryPathForBoard(input.boardId), input.base, input.head, input.path);
}

/** @param {import("electron").IpcMainInvokeEvent} _event @param {unknown} input */
async function prepareGitCommits(_event, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input) || !("boardId" in input)) throw new Error("A board is required for this Git action.");
  return gitWorkflow.prepare(await repositoryPathForBoard(input.boardId), input);
}

/** @param {import("electron").IpcMainInvokeEvent} _event @param {unknown} input */
async function executeGitCommits(_event, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("A confirmed Git plan is required.");
  const confirmationToken = "confirmationToken" in input ? input.confirmationToken : undefined;
  const push = "push" in input ? input.push : undefined;
  if (typeof confirmationToken !== "string" || typeof push !== "boolean") throw new Error("A confirmed Git plan is required.");
  return gitWorkflow.execute(confirmationToken, push);
}

/** @param {import("electron").IpcMainInvokeEvent} _event @param {unknown} input */
async function pushGitBranch(_event, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input) || !("boardId" in input)) throw new Error("A board is required for this Git action.");
  return gitWorkflow.push(await repositoryPathForBoard(input.boardId));
}

async function openStorageLocation() {
  shell.showItemInFolder(dataFilePath());
  return { opened: true };
}

// --- workspace watcher ------------------------------------------------------------

/**
 * @param {BrowserWindow} window
 */
function broadcastWorkspaceChanged(window) {
  if (workspaceWatchTimeout !== null) clearTimeout(workspaceWatchTimeout);
  workspaceWatchTimeout = setTimeout(() => {
    workspaceWatchTimeout = null;
    void loadWorkspaceData(dataFilePath()).then((workspace) => {
      const serialized = JSON.stringify(workspace);
      if (serialized === lastBroadcastWorkspace) return;
      lastBroadcastWorkspace = serialized;
      if (!window.isDestroyed()) window.webContents.send("relay:workspace:changed", workspace);
    }).catch((error) => {
      logMain("Could not reload changed workspace data", error);
    });
  }, 80);
}

function closeWorkspaceWatcher() {
  workspaceWatcher?.close();
  workspaceWatcher = null;
  if (workspaceWatchTimeout !== null) clearTimeout(workspaceWatchTimeout);
  workspaceWatchTimeout = null;
}

/**
 * @param {BrowserWindow} window
 */
function watchWorkspace(window) {
  closeWorkspaceWatcher();
  const filePath = dataFilePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  void loadWorkspaceData(filePath).then((workspace) => {
    lastBroadcastWorkspace = JSON.stringify(workspace);
  }).catch(() => undefined);
  workspaceWatcher = watch(path.dirname(filePath), { persistent: false }, (_event, filename) => {
    if (filename !== path.basename(filePath)) return;
    broadcastWorkspaceChanged(window);
  });
  // Lightweight reconciliation fallback: if a filesystem event is ever missed
  // (e.g. an editor/plugin writes while the app is backgrounded), reconcile on
  // focus. broadcastWorkspaceChanged is a no-op when nothing actually changed,
  // so this stays event-driven rather than polling.
  window.on("focus", () => broadcastWorkspaceChanged(window));
  window.on("closed", () => closeWorkspaceWatcher());
}

// --- integration (plugin) config --------------------------------------------------

const defaultIntegrationConfig = Object.freeze({
  enabled: true,
  localOnly: false,
  repositories: {},
  uploadSourceSnippets: false,
  storeRawTranscripts: false,
  automaticBoardCreation: "ask",
  checkpointFrequency: "meaningful_steps",
});

function integrationConfigPath() {
  return path.join(homedir(), ".relay", "integrations", "config.json");
}

async function getIntegrationConfig() {
  const configPath = integrationConfigPath();
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { config: { ...defaultIntegrationConfig }, configPath, exists: true };
    }
    return {
      config: { ...defaultIntegrationConfig, ...parsed, repositories: parsed.repositories ?? {} },
      configPath,
      exists: true,
    };
  } catch (error) {
    const missing = error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
    return { config: { ...defaultIntegrationConfig }, configPath, exists: !missing };
  }
}

/**
 * @param {import("electron").IpcMainInvokeEvent} _event
 * @param {unknown} update
 */
async function setIntegrationConfig(_event, update) {
  if (update === null || typeof update !== "object" || Array.isArray(update)) {
    throw new Error("Relay integration settings must be an object.");
  }
  const { config, configPath } = await getIntegrationConfig();
  const next = { ...config, ...update };
  next.enabled = next.enabled === true;
  next.localOnly = next.localOnly === true;
  next.uploadSourceSnippets = next.uploadSourceSnippets === true;
  next.storeRawTranscripts = next.storeRawTranscripts === true;
  if (!["ask", "off", "on"].includes(next.automaticBoardCreation)) next.automaticBoardCreation = "ask";
  if (!["manual", "meaningful_steps"].includes(next.checkpointFrequency)) next.checkpointFrequency = "meaningful_steps";
  if (next.repositories === null || typeof next.repositories !== "object" || Array.isArray(next.repositories)) {
    next.repositories = {};
  }
  await mkdir(path.dirname(configPath), { recursive: true });
  const temporaryPath = path.join(path.dirname(configPath), `config-${process.pid}-${randomUUID()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, configPath);
  return { config: next, configPath, exists: true };
}

// --- application settings (updates + background) ----------------------------------

async function getAppSettings() {
  const settings = await loadAppSettings(app.getPath("userData"));
  return { settings, backgroundStatus: background.getStatus() };
}

/**
 * @param {import("electron").IpcMainInvokeEvent} _event
 * @param {unknown} patch
 */
async function setAppSettings(_event, patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Relay settings updates must be an object.");
  }
  const settings = await saveAppSettings(app.getPath("userData"), patch);
  background.setSettings(settings.background);
  syncTrayPresence();
  applyBackgroundPresence();
  refreshTray();
  return { settings, backgroundStatus: background.getStatus() };
}

// --- native path helpers ----------------------------------------------------------

/**
 * @param {unknown} value
 * @returns {string}
 */
function requirePathString(value) {
  if (typeof value !== "string" || value.trim() === "" || !path.isAbsolute(value)) {
    throw new Error("Relay requires an absolute path for this action.");
  }
  return value;
}

/**
 * @param {import("electron").IpcMainInvokeEvent} _event
 * @param {unknown} value
 */
async function openPathInFileManager(_event, value) {
  const target = requirePathString(value);
  const error = await shell.openPath(target);
  if (error !== "") return { opened: false, error };
  return { opened: true };
}

/**
 * @param {import("electron").IpcMainInvokeEvent} _event
 * @param {unknown} value
 */
async function openPathInTerminal(_event, value) {
  const target = requirePathString(value);
  return platformService.openInTerminal(target);
}

/**
 * @param {import("electron").IpcMainInvokeEvent} _event
 * @param {unknown} value
 */
async function copyTextToClipboard(_event, value) {
  if (typeof value !== "string" || value === "") throw new Error("Nothing to copy.");
  clipboard.writeText(value);
  return { copied: true };
}

/**
 * @param {import("electron").IpcMainInvokeEvent} _event
 * @param {unknown} value
 */
async function moveDirectoryToTrash(_event, value) {
  const target = requirePathString(value);
  const userData = app.getPath("userData");
  if (
    platformService.pathsEqual(target, path.parse(target).root) ||
    platformService.pathsEqual(target, homedir()) ||
    platformService.pathContains(target, userData)
  ) {
    throw new Error("Relay refuses to delete this directory.");
  }
  try {
    await shell.trashItem(target);
    return { trashed: true };
  } catch (error) {
    return { trashed: false, error: error instanceof Error ? error.message : "The directory could not be moved to the trash." };
  }
}

/**
 * @param {import("electron").IpcMainInvokeEvent} event
 * @returns {Promise<{ name: string; path: string } | null>}
 */
async function chooseDirectory(event) {
  const parent = BrowserWindow.fromWebContents(event.sender);
  /** @type {import("electron").OpenDialogOptions} */
  const options = {
    buttonLabel: "Use Directory",
    message: "Choose a project directory for Relay",
    properties: ["openDirectory", "createDirectory"],
  };
  const result = parent === null
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(parent, options);

  if (result.canceled || result.filePaths[0] === undefined) return null;

  const directoryPath = result.filePaths[0];
  return {
    name: path.basename(directoryPath) || directoryPath,
    path: directoryPath,
  };
}

// --- update wiring ----------------------------------------------------------------

/** @type {import("./updater-service.cjs").UpdateState | null} */
let lastUpdateState = null;

/** @param {import("./updater-service.cjs").UpdateState} state */
function broadcastUpdateState(state) {
  lastUpdateState = state;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("relay:updates:state", state);
  }
  refreshTray();
}

function ensureUpdater() {
  if (updater !== null) return updater;
  autoUpdater.autoDownload = false;
  autoUpdater.logger = { info: () => undefined, warn: () => undefined, error: (m) => logMain("updater", m), debug: () => undefined };
  updater = createUpdaterService({
    autoUpdater,
    userDataPath: app.getPath("userData"),
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platformService,
    loadUpdateSettings: async () => (await loadAppSettings(app.getPath("userData"))).updates,
    persistUpdateSettings: async (updates) => { await saveAppSettings(app.getPath("userData"), { updates }); },
    emit: (state) => broadcastUpdateState(state),
    log: logMain,
  });
  return updater;
}

async function getUpdateState() {
  const service = ensureUpdater();
  if (lastUpdateState === null) {
    const settings = (await loadAppSettings(app.getPath("userData"))).updates;
    const current = service.getState();
    lastUpdateState = { ...current, channel: settings.channel, skippedVersion: settings.skippedVersion, dismissedVersion: settings.dismissedVersion, lastCheckAt: settings.lastCheckAt };
  }
  return lastUpdateState;
}

/** @param {import("electron").IpcMainInvokeEvent | null} _event @param {unknown} input */
async function checkForUpdates(_event, input) {
  diagnostics.recordEvent("updateCheck");
  const manual = input !== null && typeof input === "object" && !Array.isArray(input) && Reflect.get(input, "manual") === true;
  return ensureUpdater().check({ manual });
}

async function downloadUpdate() {
  return ensureUpdater().download();
}

async function installUpdate() {
  return ensureUpdater().installAndRestart();
}

/** @param {import("electron").IpcMainInvokeEvent} _event @param {unknown} version */
async function skipUpdateVersion(_event, version) {
  if (typeof version !== "string" || version === "") throw new Error("A version is required to skip.");
  return ensureUpdater().skipVersion(version);
}

/** @param {import("electron").IpcMainInvokeEvent} _event @param {unknown} version */
async function dismissUpdateVersion(_event, version) {
  if (typeof version !== "string" || version === "") throw new Error("A version is required to dismiss.");
  return ensureUpdater().dismissVersion(version);
}

async function getDiagnostics() {
  return diagnostics.snapshot();
}

// --- window & background presence -------------------------------------------------

/** @returns {BrowserWindow | undefined} */
function openMainWindow() {
  const existing = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  if (existing !== undefined) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    if (platformService.isMac && app.dock) void app.dock.show();
    return existing;
  }
  void getInitialAppearance()
    .then((appearance) => createWindow(appearance))
    .catch((error) => {
      logMain("Could not read saved appearance", error);
      createWindow(currentAppearance);
    });
  return undefined;
}

// On macOS, present as a menu-bar app (hidden Dock icon) only while background
// mode is on and no window is visible; otherwise keep the normal Dock presence.
function applyBackgroundPresence() {
  if (!platformService.isMac || !app.dock) return;
  const anyVisible = BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isVisible());
  if (!anyVisible && background.getSettings().runInBackground) {
    void app.dock.hide();
  } else {
    void app.dock.show();
  }
}

/** @param {"dark" | "light" | "system"} appearance */
function createWindow(appearance) {
  applyNativeAppearance(appearance);
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: nativeTheme.shouldUseDarkColors ? darkWindowBackground : lightWindowBackground,
    show: false,
    title: "Relay",
    titleBarStyle: platformService.isMac ? "hiddenInset" : "default",
    // Traffic-light positioning is a macOS-only concept; omit it elsewhere.
    ...(platformService.isMac ? { trafficLightPosition: { x: 20, y: 24 } } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
    applyBackgroundPresence();
    // Push the latest update state to a freshly-opened window.
    if (lastUpdateState !== null && !window.isDestroyed()) window.webContents.send("relay:updates:state", lastUpdateState);
  });
  window.webContents.on("console-message", (event) => {
    if (!isDevelopment) return;
    console.log(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    logMain(`Renderer failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  // Closing the window hides Relay (staying in tray/menu bar) or fully quits,
  // per the user's background settings. An explicit Quit has already latched the
  // quitting flag, so this handler steps aside for it.
  window.on("close", (event) => {
    if (background.isQuitting()) return;
    if (background.resolveCloseIntent() === "hide") {
      event.preventDefault();
      window.hide();
      applyBackgroundPresence();
    }
  });

  const developmentUrl = process.env.RELAY_DEV_SERVER_URL;
  if (developmentUrl !== undefined) {
    void window.loadURL(developmentUrl).catch((error) => {
      logMain(`Failed to load the development renderer at ${developmentUrl}`, error);
    });
  } else {
    const rendererPath = path.join(__dirname, "..", "renderer", "index.html");
    void window.loadFile(rendererPath).catch((error) => {
      logMain(`Failed to load the packaged renderer at ${rendererPath}`, error);
    });
  }

  watchWorkspace(window);
}

// --- tray ------------------------------------------------------------------------

function updateStatusLabel() {
  const status = background.getStatus();
  const phase = lastUpdateState?.phase;
  if (phase === "downloading") return "Downloading update…";
  if (phase === "ready") return "Update ready to install";
  if (phase === "available") return `Update ${lastUpdateState?.availableVersion ?? ""} available`;
  if (status.runInBackground) return "Running in background";
  return "Relay is active";
}

function refreshTray() {
  if (tray !== null) tray.refresh();
}

function syncTrayPresence() {
  const settings = background.getSettings();
  const shouldHaveTray = settings.runInBackground || settings.keepAliveOnClose;
  if (shouldHaveTray) {
    if (tray === null) {
      tray = createTrayService({
        platformService,
        onOpen: () => openMainWindow(),
        onCheckForUpdates: () => { void checkForUpdates(null, { manual: true }); },
        onQuit: () => { void background.requestQuit(); },
        getStatusLabel: updateStatusLabel,
        log: logMain,
      });
      background.registerTeardown(() => tray?.destroy());
    }
    tray.ensure();
    tray.refresh();
  } else if (tray !== null) {
    tray.destroy();
    tray = null;
  }
}

// --- discovery --------------------------------------------------------------------

/**
 * @param {import("electron").IpcMainInvokeEvent} _event
 * @param {{ repoPath: string }} input
 */
/**
 * repoPath is used as a raw object key, so casing and trailing-slash drift
 * between what the renderer passes and what git reports would silently miss
 * on case-insensitive volumes. Normalize on every read and write.
 * @param {string} repoPath
 */
function discoveryKey(repoPath) {
  return path.resolve(repoPath).replace(/\/+$/, "").toLowerCase();
}

/**
 * @param {any} workspace
 * @param {string} repoPath
 */
function readDiscovery(workspace, repoPath) {
  /** @type {Record<string, any>} */
  const discoveries = workspace.discoveries ?? {};
  const key = discoveryKey(repoPath);
  if (discoveries[key]) return discoveries[key];
  // Pre-normalization indexes were keyed by the raw path; adopt them rather
  // than silently rescanning and orphaning the old entry.
  const legacy = Object.keys(discoveries).find((k) => discoveryKey(k) === key);
  return legacy === undefined ? undefined : discoveries[legacy];
}

/**
 * @param {import("electron").IpcMainInvokeEvent} _event
 * @param {{ repoPath: string; force?: boolean; discoveredBy?: string }} input
 */
async function startDiscovery(_event, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("Repo path is required for discovery.");
  if (typeof input.repoPath !== "string" || input.repoPath.trim() === "") throw new Error("A repository path is required for discovery.");

  diagnostics.recordEvent("discoveryScan");
  const workspace = await loadWorkspace();
  const key = discoveryKey(input.repoPath);
  const existing = readDiscovery(workspace, input.repoPath);
  const discoveredBy = input.discoveredBy ?? "relay-desktop";

  let index;
  if (input.force === true || existing === undefined || (existing.entries ?? []).length === 0) {
    index = await discoverRepository(input.repoPath, { discoveredBy });
  } else {
    index = await incrementalDiscovery(input.repoPath, existing, discoveredBy);
  }

  index.repoPath = input.repoPath;
  delete index.boardId;

  if (workspace.discoveries === undefined) workspace.discoveries = {};
  // Drop any legacy raw-path key so the same repo is never indexed twice.
  for (const k of Object.keys(workspace.discoveries)) {
    if (k !== key && discoveryKey(k) === key) delete workspace.discoveries[k];
  }
  workspace.discoveries[key] = index;

  await saveWorkspace(_event, workspace);
  return index;
}

/**
 * Re-inspects only what changed. Unchanged entries are carried forward by
 * reference, so an incremental pass costs one walk plus a hash of the files
 * whose mtime actually moved.
 * @param {string} repoPath
 * @param {any} existing
 * @param {string} discoveredBy
 */
async function incrementalDiscovery(repoPath, existing, discoveredBy) {
  /** @type {Array<any>} */
  const previous = existing.entries ?? [];
  const diff = await diffDiscovery(repoPath, previous);
  const deleted = new Set(diff.deleted);
  const reinspect = [...new Set([...diff.changed, ...diff.added])];

  const carried = previous.filter((/** @type {any} */ e) => !deleted.has(e.filePath) && !reinspect.includes(e.filePath));
  /** @type {Array<any>} */
  const rebuilt = [];
  for (const relativePath of reinspect) {
    const entry = await buildEntry(repoPath, relativePath, { discoveredBy });
    if (entry !== null) rebuilt.push(entry);
  }

  const entries = [...carried, ...rebuilt].sort((/** @type {any} */ a, /** @type {any} */ b) => a.filePath.localeCompare(b.filePath));

  // Deleting an entry orphans inbound relatedFiles/dependencies references on
  // entries that were carried forward untouched. Sweep them or those become
  // the stale paths that make the index untrustworthy.
  const live = new Set(entries.map((/** @type {any} */ e) => e.filePath));
  let staleRelationshipCount = 0;
  for (const entry of entries) {
    const related = entry.relatedFiles.filter((/** @type {string} */ p) => live.has(p));
    const deps = entry.dependencies.filter((/** @type {string} */ p) => live.has(p) || !deleted.has(p));
    staleRelationshipCount += (entry.relatedFiles.length - related.length);
    entry.relatedFiles = related;
    entry.dependencies = deps;
  }

  /** @type {Map<string, { name: string; description: string; filePaths: string[] }>} */
  const featureMap = new Map();
  for (const entry of entries) {
    const name = entry.features[0];
    if (!name) continue;
    if (!featureMap.has(name)) featureMap.set(name, { name, description: `${name} feature area`, filePaths: [] });
    featureMap.get(name)?.filePaths.push(entry.filePath);
  }

  return {
    entries,
    features: [...featureMap.values()],
    // An incremental pass is not a full discovery; keep the original timestamp
    // so staleness is measured from the last time everything was actually read.
    lastFullDiscovery: existing.lastFullDiscovery ?? new Date().toISOString(),
    lastIncrementalDiscovery: new Date().toISOString(),
    coverage: existing.coverage ?? 100,
    staleRelationshipCount,
    discoveryCount: entries.length,
    version: (existing.version ?? 1) + 1,
  };
}

/**
 * @param {import("electron").IpcMainInvokeEvent} _event
 * @param {{ repoPath: string }} input
 */
async function getDiscoveryDiff(_event, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("Repo path is required.");
  if (typeof input.repoPath !== "string" || input.repoPath.trim() === "") throw new Error("A repository path is required.");
  const workspace = await loadWorkspace();
  const existing = readDiscovery(workspace, input.repoPath)?.entries ?? [];
  if (existing.length === 0) return { changed: [], added: [], deleted: [], needsFullDiscovery: true };
  const diff = await diffDiscovery(input.repoPath, existing);
  return { ...diff, needsFullDiscovery: false };
}

/**
 * Returns the stored index with status derived against current disk state.
 * The UI and the plugin context packet both read through this so they can
 * never disagree about which files are changed.
 * @param {import("electron").IpcMainInvokeEvent} _event
 * @param {{ repoPath: string }} input
 */
async function getDiscovery(_event, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("Repo path is required.");
  if (typeof input.repoPath !== "string" || input.repoPath.trim() === "") throw new Error("A repository path is required.");
  const workspace = await loadWorkspace();
  const stored = readDiscovery(workspace, input.repoPath);
  if (stored === undefined) return null;
  return { ...stored, entries: await withDerivedStatus(input.repoPath, stored.entries ?? []) };
}

/**
 * @param {import("electron").IpcMainInvokeEvent} _event
 * @param {{ repoPath: string; filePaths: string[]; discoveredBy: string }} input
 */
async function updateDiscoveryFiles(_event, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("Repo path and file paths are required.");
  if (typeof input.repoPath !== "string" || input.repoPath.trim() === "") throw new Error("A repository path is required.");
  if (!Array.isArray(input.filePaths)) throw new Error("filePaths must be an array.");

  const workspace = await loadWorkspace();
  const key = discoveryKey(input.repoPath);
  const discovery = readDiscovery(workspace, input.repoPath);
  if (!discovery) throw new Error("No discovery index exists for this repo path. Run full discovery first.");

  /** @type {Array<any>} */
  const entries = (discovery.entries ?? []).slice();
  const discoveredBy = input.discoveredBy ?? "relay";
  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const filePath of input.filePaths) {
    if (typeof filePath !== "string" || filePath.trim() === "") continue;
    const relativePath = path.isAbsolute(filePath)
      ? path.relative(input.repoPath, filePath)
      : filePath;
    // A path outside the repo would resolve to ../.. and poison the index.
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) continue;

    const idx = entries.findIndex((/** @type {any} */ e) => e.filePath === relativePath);
    // buildEntry returns null when the file is unreadable, which is how a
    // deletion presents. Drop the entry rather than leaving a stale path.
    const entry = await buildEntry(input.repoPath, relativePath, { discoveredBy });
    if (entry === null) {
      if (idx !== -1) { entries.splice(idx, 1); removed += 1; }
      continue;
    }
    if (idx === -1) { entries.push(entry); added += 1; }
    else { entries[idx] = entry; updated += 1; }
  }

  entries.sort((/** @type {any} */ a, /** @type {any} */ b) => a.filePath.localeCompare(b.filePath));

  const live = new Set(entries.map((/** @type {any} */ e) => e.filePath));
  let staleRelationshipCount = 0;
  for (const entry of entries) {
    const related = entry.relatedFiles.filter((/** @type {string} */ p) => live.has(p));
    staleRelationshipCount += entry.relatedFiles.length - related.length;
    entry.relatedFiles = related;
  }

  /** @type {Map<string, { name: string; description: string; filePaths: string[] }>} */
  const featureMap = new Map();
  for (const entry of entries) {
    const name = entry.features[0];
    if (!name) continue;
    if (!featureMap.has(name)) featureMap.set(name, { name, description: `${name} feature area`, filePaths: [] });
    featureMap.get(name)?.filePaths.push(entry.filePath);
  }

  if (workspace.discoveries === undefined) workspace.discoveries = {};
  workspace.discoveries[key] = {
    ...discovery,
    entries,
    features: [...featureMap.values()],
    staleRelationshipCount,
    discoveryCount: entries.length,
    lastIncrementalDiscovery: new Date().toISOString(),
    version: (discovery.version ?? 1) + 1,
  };
  await saveWorkspace(_event, workspace);
  return { ...workspace.discoveries[key], applied: { added, updated, removed } };
}

/** In-flight enrichment runs, keyed by repo, so cancel can reach them. */
const enrichmentRuns = new Map();

function getDiscoveryAgents() {
  return listAgents();
}

/**
 * Hybrid enrichment: the heuristic index already covers the repo, this upgrades
 * selected entries to agent-written purposes. Defaults to entries that were
 * never enriched, so repeated runs do not re-pay for the same summaries.
 *
 * @param {import("electron").IpcMainInvokeEvent} event
 * @param {{ repoPath: string; agent: string; model?: string; filePaths?: string[]; limit?: number }} input
 */
async function enrichDiscovery(event, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("Enrichment input is required.");
  if (typeof input.repoPath !== "string" || input.repoPath.trim() === "") throw new Error("A repository path is required.");
  if (typeof input.agent !== "string" || input.agent.trim() === "") throw new Error("An agent is required.");

  const key = discoveryKey(input.repoPath);
  if (enrichmentRuns.has(key)) throw new Error("An enrichment run is already active for this repository.");

  const workspace = await loadWorkspace();
  const discovery = readDiscovery(workspace, input.repoPath);
  if (!discovery) throw new Error("No discovery index exists for this repo path. Run discovery first.");

  /** @type {Array<any>} */
  const entries = discovery.entries ?? [];
  const candidates = Array.isArray(input.filePaths) && input.filePaths.length > 0
    ? input.filePaths
    : entries.filter((/** @type {any} */ e) => e.enriched !== true).map((/** @type {any} */ e) => e.filePath);
  const limit = typeof input.limit === "number" && input.limit > 0 ? input.limit : candidates.length;
  const filePaths = candidates.slice(0, limit);

  if (filePaths.length === 0) {
    return { ...discovery, enriched: 0, failed: [], alreadyComplete: true };
  }

  const controller = new AbortController();
  enrichmentRuns.set(key, controller);
  diagnostics.recordEvent("discoveryEnrich");

  try {
    const result = await enrichEntries({
      repoRoot: input.repoPath,
      entries,
      filePaths,
      agent: input.agent,
      model: input.model,
      signal: controller.signal,
      onProgress: (progress) => {
        // Progress goes to the renderer only. Mirroring it to stdout would
        // duplicate the same tokens in two places for no added information.
        if (!event.sender.isDestroyed()) {
          event.sender.send("relay:discovery:progress", { repoPath: input.repoPath, ...progress });
        }
      },
    });

    /** @type {Map<string, { name: string; description: string; filePaths: string[] }>} */
  const featureMap = new Map();
    for (const entry of result.entries) {
      for (const name of entry.features) {
        if (!featureMap.has(name)) featureMap.set(name, { name, description: `${name} feature area`, filePaths: [] });
        featureMap.get(name)?.filePaths.push(entry.filePath);
      }
    }

    const updated = {
      ...discovery,
      entries: result.entries,
      features: [...featureMap.values()],
      lastEnrichment: new Date().toISOString(),
      enrichedCount: result.entries.filter((/** @type {any} */ e) => e.enriched === true).length,
      version: (discovery.version ?? 1) + 1,
    };

    if (workspace.discoveries === undefined) workspace.discoveries = {};
    workspace.discoveries[key] = updated;
    await saveWorkspace(event, workspace);

    // Partial failures still persist: the batches that succeeded are real work.
    return { ...updated, enriched: result.enriched, failed: result.failed, error: result.error };
  } finally {
    enrichmentRuns.delete(key);
  }
}

/**
 * @param {import("electron").IpcMainInvokeEvent} _event
 * @param {{ repoPath: string }} input
 */
function cancelDiscoveryEnrichment(_event, input) {
  if (input === null || typeof input !== "object") throw new Error("Repo path is required.");
  const controller = enrichmentRuns.get(discoveryKey(input.repoPath));
  if (controller === undefined) return { cancelled: false };
  controller.abort();
  return { cancelled: true };
}

// --- IPC registration -------------------------------------------------------------

ipcMain.handle("relay:workspace:load", loadWorkspace);
ipcMain.handle("relay:workspace:save", saveWorkspace);
ipcMain.handle("relay:discovery:start", startDiscovery);
ipcMain.handle("relay:discovery:get", getDiscovery);
ipcMain.handle("relay:discovery:diff", getDiscoveryDiff);
ipcMain.handle("relay:discovery:update", updateDiscoveryFiles);
ipcMain.handle("relay:discovery:agents", getDiscoveryAgents);
ipcMain.handle("relay:discovery:enrich", enrichDiscovery);
ipcMain.handle("relay:discovery:cancel", cancelDiscoveryEnrichment);
ipcMain.handle("relay:storage:info", getStorageInfo);
ipcMain.handle("relay:storage:open", openStorageLocation);
ipcMain.handle("relay:directory:choose", chooseDirectory);
ipcMain.handle("relay:integration:config:get", getIntegrationConfig);
ipcMain.handle("relay:integration:config:set", setIntegrationConfig);
ipcMain.handle("relay:settings:get", getAppSettings);
ipcMain.handle("relay:settings:set", setAppSettings);
ipcMain.handle("relay:path:open", openPathInFileManager);
ipcMain.handle("relay:path:terminal", openPathInTerminal);
ipcMain.handle("relay:clipboard:copy", copyTextToClipboard);
ipcMain.handle("relay:path:trash", moveDirectoryToTrash);
ipcMain.handle("relay:git:status", getGitStatus);
ipcMain.handle("relay:git:diff", getGitDiff);
ipcMain.handle("relay:git:history", getGitHistory);
ipcMain.handle("relay:git:compare", compareGitCommits);
ipcMain.handle("relay:git:compare-diff", getGitCommitDiff);
ipcMain.handle("relay:git:prepare", prepareGitCommits);
ipcMain.handle("relay:git:execute", executeGitCommits);
ipcMain.handle("relay:git:push", pushGitBranch);
ipcMain.handle("relay:updates:state", getUpdateState);
ipcMain.handle("relay:updates:check", checkForUpdates);
ipcMain.handle("relay:updates:download", downloadUpdate);
ipcMain.handle("relay:updates:install", installUpdate);
ipcMain.handle("relay:updates:skip", skipUpdateVersion);
ipcMain.handle("relay:updates:dismiss", dismissUpdateVersion);
ipcMain.handle("relay:diagnostics:get", getDiagnostics);

// --- lifecycle -------------------------------------------------------------------

app.on("second-instance", () => openMainWindow());

void app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;

  const initial = await loadAppSettings(app.getPath("userData"));
  background.setSettings(initial.background);
  syncTrayPresence();

  const appearance = await getInitialAppearance();
  createWindow(appearance);

  // Confirm any previously-staged update actually took effect, then clean up.
  await ensureUpdater().verifyPendingInstall(semver.gte);

  // Automatic check shortly after launch, if enabled (and never for skipped
  // versions — the updater consults settings before surfacing anything).
  if (initial.updates.autoCheck) {
    setTimeout(() => { void checkForUpdates(null, { manual: false }); }, 4000);
  }

  app.on("activate", () => openMainWindow());
}).catch((error) => {
  logMain("Failed to start", error);
  app.quit();
});

nativeTheme.on("updated", () => applyNativeAppearance(currentAppearance));

// All windows closed: stay resident only when background mode asks us to;
// otherwise quit cleanly on every platform (macOS included).
app.on("window-all-closed", () => {
  if (background.shouldStayResidentWithNoWindows()) {
    applyBackgroundPresence();
    return;
  }
  void background.requestQuit();
});

// Any quit path (Cmd-Q, menu, tray) tears down watchers, timers, tray and child
// processes exactly once before the process exits.
app.on("before-quit", () => { void background.beginQuit(); });

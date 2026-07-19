const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("relayDesktop", {
  chooseDirectory: () => ipcRenderer.invoke("relay:directory:choose"),
  getIntegrationConfig: () => ipcRenderer.invoke("relay:integration:config:get"),
  /** @param {unknown} update */
  setIntegrationConfig: (update) => ipcRenderer.invoke("relay:integration:config:set", update),
  /** @param {string} path */
  openPath: (path) => ipcRenderer.invoke("relay:path:open", path),
  /** @param {string} path */
  openPathInTerminal: (path) => ipcRenderer.invoke("relay:path:terminal", path),
  /** @param {string} text */
  copyText: (text) => ipcRenderer.invoke("relay:clipboard:copy", text),
  /** @param {string} path */
  moveDirectoryToTrash: (path) => ipcRenderer.invoke("relay:path:trash", path),
  /** @param {{ boardId: string }} input */
  getGitStatus: (input) => ipcRenderer.invoke("relay:git:status", input),
  /** @param {{ boardId: string; path: string }} input */
  getGitDiff: (input) => ipcRenderer.invoke("relay:git:diff", input),
  /** @param {{ boardId: string; limit?: number }} input */
  getGitHistory: (input) => ipcRenderer.invoke("relay:git:history", input),
  /** @param {{ boardId: string; base: string; head: string }} input */
  compareGitCommits: (input) => ipcRenderer.invoke("relay:git:compare", input),
  /** @param {{ boardId: string; base: string; head: string; path: string }} input */
  getGitCommitDiff: (input) => ipcRenderer.invoke("relay:git:compare-diff", input),
  /** @param {unknown} input */
  prepareGitCommits: (input) => ipcRenderer.invoke("relay:git:prepare", input),
  /** @param {{ confirmationToken: string; push: boolean }} input */
  executeGitCommits: (input) => ipcRenderer.invoke("relay:git:execute", input),
  /** @param {{ boardId: string }} input */
  pushGitBranch: (input) => ipcRenderer.invoke("relay:git:push", input),
  getStorageInfo: () => ipcRenderer.invoke("relay:storage:info"),
  openStorageLocation: () => ipcRenderer.invoke("relay:storage:open"),
  getAppSettings: () => ipcRenderer.invoke("relay:settings:get"),
  /** @param {unknown} patch */
  setAppSettings: (patch) => ipcRenderer.invoke("relay:settings:set", patch),
  getUpdateState: () => ipcRenderer.invoke("relay:updates:state"),
  /** @param {{ manual?: boolean }} [input] */
  checkForUpdates: (input) => ipcRenderer.invoke("relay:updates:check", input ?? { manual: true }),
  downloadUpdate: () => ipcRenderer.invoke("relay:updates:download"),
  installUpdate: () => ipcRenderer.invoke("relay:updates:install"),
  /** @param {string} version */
  skipUpdateVersion: (version) => ipcRenderer.invoke("relay:updates:skip", version),
  /** @param {string} version */
  dismissUpdateVersion: (version) => ipcRenderer.invoke("relay:updates:dismiss", version),
  /** @param {(state: unknown) => void} callback */
  onUpdateState: (callback) => {
    /** @type {(_event: Electron.IpcRendererEvent, state: unknown) => void} */
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("relay:updates:state", listener);
    return () => ipcRenderer.removeListener("relay:updates:state", listener);
  },
  getDiagnostics: () => ipcRenderer.invoke("relay:diagnostics:get"),
  loadWorkspace: () => ipcRenderer.invoke("relay:workspace:load"),
  /** @param {(workspace: unknown) => void} callback */
  onWorkspaceChanged: (callback) => {
    /** @type {(_event: Electron.IpcRendererEvent, workspace: unknown) => void} */
    const listener = (_event, workspace) => callback(workspace);
    ipcRenderer.on("relay:workspace:changed", listener);
    return () => ipcRenderer.removeListener("relay:workspace:changed", listener);
  },
  /** @param {unknown} workspace */
  saveWorkspace: (workspace) => ipcRenderer.invoke("relay:workspace:save", workspace),
});

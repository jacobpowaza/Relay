"use strict";

// Cross-platform auto-update flow built on electron-updater (the maintained
// companion to electron-builder). electron-updater owns the security-critical
// parts — per-OS/arch asset selection from GitHub Releases, sha512 checksum
// verification, and code-signature validation — so a mismatched or incomplete
// download is rejected before it is ever executed. This module adds the state
// machine, retry, skip/dismiss persistence, and post-restart verification.

const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { mkdir, readFile, rename, writeFile, unlink } = require("node:fs/promises");

const GITHUB_OWNER = "jacobpowaza";
const GITHUB_REPO = "Relay";
const MAX_DOWNLOAD_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2000;

/**
 * @typedef {"idle"|"checking"|"current"|"available"|"downloading"|"ready"|"failed"} UpdatePhase
 * @typedef {{
 *   phase: UpdatePhase;
 *   currentVersion: string;
 *   availableVersion: string | null;
 *   releaseName: string | null;
 *   releaseNotes: string | null;
 *   releaseDate: string | null;
 *   releaseUrl: string | null;
 *   progress: { percent: number; transferred: number; total: number; bytesPerSecond: number } | null;
 *   error: string | null;
 *   lastCheckAt: string | null;
 *   channel: "stable" | "prerelease";
 *   target: { platform: string; arch: string; label: string };
 *   skippedVersion: string | null;
 *   dismissedVersion: string | null;
 *   checkedManually: boolean;
 *   supported: boolean;
 *   note: string | null;
 * }} UpdateState
 */

/**
 * @param {{
 *   autoUpdater: import("electron-updater").AppUpdater;
 *   userDataPath: string;
 *   currentVersion: string;
 *   isPackaged: boolean;
 *   platformService: typeof import("./platform-service.cjs");
 *   loadUpdateSettings: () => Promise<import("./app-settings.cjs").RelayUpdateSettings>;
 *   persistUpdateSettings: (patch: Partial<import("./app-settings.cjs").RelayUpdateSettings>) => Promise<void>;
 *   emit: (state: UpdateState) => void;
 *   log?: (message: string, error?: unknown) => void;
 * }} deps
 */
function createUpdaterService(deps) {
  const { autoUpdater, userDataPath, currentVersion, isPackaged, platformService, loadUpdateSettings, persistUpdateSettings, emit } = deps;
  const log = deps.log ?? (() => undefined);
  const target = platformService.describeTarget();
  const pendingMarkerPath = path.join(userDataPath, "relay-pending-update.json");

  // Updates are driven explicitly through this service so we can retry and
  // report progress; electron-updater's own auto-download is left off.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  if (typeof autoUpdater.setFeedURL === "function") {
    autoUpdater.setFeedURL({ provider: "github", owner: GITHUB_OWNER, repo: GITHUB_REPO });
  }

  /** @type {UpdateState} */
  let state = {
    phase: "idle",
    currentVersion,
    availableVersion: null,
    releaseName: null,
    releaseNotes: null,
    releaseDate: null,
    releaseUrl: null,
    progress: null,
    error: null,
    lastCheckAt: null,
    channel: "stable",
    target,
    skippedVersion: null,
    dismissedVersion: null,
    checkedManually: false,
    supported: isPackaged || process.env.RELAY_FORCE_UPDATE === "1",
    note: null,
  };

  let checking = false;

  /** @param {Partial<UpdateState>} patch */
  function setState(patch) {
    state = { ...state, ...patch };
    emit(state);
  }

  /** @param {string} version @returns {string} */
  function releaseUrlFor(version) {
    return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/v${version}`;
  }

  /** @param {unknown} info @returns {string | null} */
  function notesFrom(info) {
    if (info === null || typeof info !== "object") return null;
    const notes = Reflect.get(info, "releaseNotes");
    if (typeof notes === "string") return notes;
    if (Array.isArray(notes)) {
      return notes
        .map((entry) => (entry && typeof entry === "object" ? `${Reflect.get(entry, "version") ?? ""}\n${Reflect.get(entry, "note") ?? ""}` : String(entry)))
        .join("\n\n")
        .trim() || null;
    }
    return null;
  }

  // --- electron-updater event wiring ------------------------------------------------

  autoUpdater.on("checking-for-update", () => setState({ phase: "checking", error: null }));

  autoUpdater.on("update-available", (info) => {
    const version = String(info?.version ?? "");
    setState({
      phase: "available",
      availableVersion: version,
      releaseName: typeof info?.releaseName === "string" ? info.releaseName : null,
      releaseNotes: notesFrom(info),
      releaseDate: typeof info?.releaseDate === "string" ? info.releaseDate : null,
      releaseUrl: releaseUrlFor(version),
      progress: null,
    });
    void loadUpdateSettings().then((settings) => {
      if (settings.autoDownload && version !== settings.skippedVersion) void download();
    });
  });

  autoUpdater.on("update-not-available", () => {
    setState({ phase: "current", availableVersion: null, releaseNotes: null, progress: null });
  });

  autoUpdater.on("download-progress", (progress) => {
    setState({
      phase: "downloading",
      progress: {
        percent: Number(progress?.percent ?? 0),
        transferred: Number(progress?.transferred ?? 0),
        total: Number(progress?.total ?? 0),
        bytesPerSecond: Number(progress?.bytesPerSecond ?? 0),
      },
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    const version = String(info?.version ?? state.availableVersion ?? "");
    void writePendingMarker(version);
    setState({ phase: "ready", availableVersion: version, progress: { percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 } });
  });

  autoUpdater.on("error", (error) => {
    log("Update error", error);
    setState({ phase: "failed", error: error instanceof Error ? error.message : String(error) });
  });

  // --- pending-update verification & cleanup ----------------------------------------

  /** @param {string} version */
  async function writePendingMarker(version) {
    try {
      await mkdir(path.dirname(pendingMarkerPath), { recursive: true });
      const tmp = path.join(path.dirname(pendingMarkerPath), `relay-pending-${process.pid}-${randomUUID()}.tmp`);
      await writeFile(tmp, JSON.stringify({ version, stagedAt: new Date().toISOString() }, null, 2), "utf8");
      await rename(tmp, pendingMarkerPath);
    } catch (error) {
      log("Could not write pending-update marker", error);
    }
  }

  async function clearPendingMarker() {
    try {
      await unlink(pendingMarkerPath);
    } catch {
      // Missing marker is the normal, healthy case.
    }
  }

  /**
   * Runs once at startup: if a version was staged for install, confirm the app
   * actually relaunched into it. On success we clear the marker; on failure we
   * surface it and let electron-updater's cache be re-fetched on next check.
   * @param {(a: string, b: string) => boolean} gte
   */
  async function verifyPendingInstall(gte) {
    let marker;
    try {
      marker = JSON.parse(await readFile(pendingMarkerPath, "utf8"));
    } catch {
      return; // No pending install to verify.
    }
    const staged = typeof marker?.version === "string" ? marker.version : null;
    if (staged === null) {
      await clearPendingMarker();
      return;
    }
    const launchedInto = gte(currentVersion, staged);
    if (launchedInto) {
      log(`Update to ${staged} confirmed (running ${currentVersion}).`);
      await clearPendingMarker();
    } else {
      log(`Staged update ${staged} did not take effect (still ${currentVersion}); clearing stale state.`);
      await clearPendingMarker();
      setState({ phase: "failed", error: `Update to ${staged} did not complete. Relay is still on ${currentVersion}. Please try again.` });
    }
  }

  // --- public operations ------------------------------------------------------------

  /** @param {{ manual?: boolean }} [options] */
  async function check(options) {
    const manual = options?.manual === true;
    const settings = await loadUpdateSettings();
    autoUpdater.channel = settings.channel === "prerelease" ? "beta" : "latest";
    autoUpdater.allowPrerelease = settings.channel === "prerelease";
    setState({
      channel: settings.channel,
      skippedVersion: settings.skippedVersion,
      dismissedVersion: settings.dismissedVersion,
      lastCheckAt: settings.lastCheckAt,
      checkedManually: manual,
    });

    if (!state.supported) {
      setState({ phase: "current", note: "Updates are delivered in packaged builds. Run a signed release build to test the full flow." });
      return state;
    }
    if (checking) return state;
    checking = true;
    try {
      const now = new Date().toISOString();
      await persistUpdateSettings({ lastCheckAt: now });
      setState({ lastCheckAt: now, error: null });
      await autoUpdater.checkForUpdates();
    } catch (error) {
      log("checkForUpdates failed", error);
      setState({ phase: "failed", error: error instanceof Error ? error.message : "Could not reach the update server." });
    } finally {
      checking = false;
    }
    return state;
  }

  async function download() {
    if (!state.supported || state.availableVersion === null) return state;
    setState({ phase: "downloading", error: null, progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 } });
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
      try {
        await autoUpdater.downloadUpdate();
        return state; // 'update-downloaded' event drives the transition to "ready".
      } catch (error) {
        lastError = error;
        log(`Download attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS} failed`, error);
        if (attempt < MAX_DOWNLOAD_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * attempt));
        }
      }
    }
    setState({ phase: "failed", error: lastError instanceof Error ? lastError.message : "The update could not be downloaded after several attempts." });
    return state;
  }

  /**
   * Installs a fully-downloaded, verified update and relaunches Relay. Refuses
   * to run if the download did not reach the "ready" state.
   */
  function installAndRestart() {
    if (state.phase !== "ready") return { installed: false, reason: "No verified update is ready to install." };
    // isSilent=false (show installer UI where relevant), isForceRunAfter=true (relaunch).
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { installed: true };
  }

  /** @param {string} version */
  async function skipVersion(version) {
    await persistUpdateSettings({ skippedVersion: version });
    setState({ skippedVersion: version });
    return state;
  }

  /** @param {string} version */
  async function dismissVersion(version) {
    await persistUpdateSettings({ dismissedVersion: version });
    setState({ dismissedVersion: version });
    return state;
  }

  function getState() {
    return state;
  }

  return { check, download, installAndRestart, skipVersion, dismissVersion, getState, verifyPendingInstall };
}

module.exports = { createUpdaterService, GITHUB_OWNER, GITHUB_REPO };

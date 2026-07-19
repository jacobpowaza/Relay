"use strict";

// Main-process-owned application settings (update + background preferences).
// Deliberately separate from board content (workspace-storage.cjs) and plugin
// config (integration config), because these are OS-level preferences that must
// not sync or entangle with user board data.

const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { mkdir, readFile, rename, writeFile } = require("node:fs/promises");

/**
 * @typedef {"stable" | "prerelease"} RelayUpdateChannel
 * @typedef {"hide" | "quit"} RelayCloseAction
 * @typedef {{
 *   autoCheck: boolean;
 *   autoDownload: boolean;
 *   channel: RelayUpdateChannel;
 *   skippedVersion: string | null;
 *   dismissedVersion: string | null;
 *   lastCheckAt: string | null;
 * }} RelayUpdateSettings
 * @typedef {{
 *   runInBackground: boolean;
 *   launchAtLogin: boolean;
 *   keepAliveOnClose: boolean;
 *   closeAction: RelayCloseAction;
 * }} RelayBackgroundSettings
 * @typedef {{ version: 1; updates: RelayUpdateSettings; background: RelayBackgroundSettings }} RelayAppSettings
 */

/** @type {RelayAppSettings} */
const defaults = Object.freeze({
  version: 1,
  updates: Object.freeze({
    autoCheck: true,
    autoDownload: false,
    channel: "stable",
    skippedVersion: null,
    dismissedVersion: null,
    lastCheckAt: null,
  }),
  background: Object.freeze({
    runInBackground: false,
    launchAtLogin: false,
    keepAliveOnClose: false,
    closeAction: "quit",
  }),
});

/** @param {string} userDataPath */
function appSettingsFilePath(userDataPath) {
  return path.join(userDataPath, "relay-settings.json");
}

/** @param {unknown} value @param {boolean} fallback */
function boolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/** @param {unknown} value @returns {string | null} */
function nullableString(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** @param {unknown} raw @returns {RelayAppSettings} */
function normalize(raw) {
  /** @type {any} */
  const source = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  /** @type {any} */
  const updatesSource = source.updates !== null && typeof source.updates === "object" && !Array.isArray(source.updates) ? source.updates : {};
  /** @type {any} */
  const backgroundSource = source.background !== null && typeof source.background === "object" && !Array.isArray(source.background) ? source.background : {};
  return {
    version: 1,
    updates: {
      autoCheck: boolean(updatesSource.autoCheck, defaults.updates.autoCheck),
      autoDownload: boolean(updatesSource.autoDownload, defaults.updates.autoDownload),
      channel: updatesSource.channel === "prerelease" ? "prerelease" : "stable",
      skippedVersion: nullableString(updatesSource.skippedVersion),
      dismissedVersion: nullableString(updatesSource.dismissedVersion),
      lastCheckAt: nullableString(updatesSource.lastCheckAt),
    },
    background: {
      runInBackground: boolean(backgroundSource.runInBackground, defaults.background.runInBackground),
      launchAtLogin: boolean(backgroundSource.launchAtLogin, defaults.background.launchAtLogin),
      keepAliveOnClose: boolean(backgroundSource.keepAliveOnClose, defaults.background.keepAliveOnClose),
      closeAction: backgroundSource.closeAction === "hide" ? "hide" : "quit",
    },
  };
}

/**
 * @param {string} userDataPath
 * @returns {Promise<RelayAppSettings>}
 */
async function loadAppSettings(userDataPath) {
  const filePath = appSettingsFilePath(userDataPath);
  try {
    return normalize(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return normalize(null);
  }
}

/**
 * Persists settings atomically. Accepts a partial patch that is merged section
 * by section over the current on-disk value.
 * @param {string} userDataPath
 * @param {{ updates?: Partial<RelayUpdateSettings>; background?: Partial<RelayBackgroundSettings> }} patch
 * @returns {Promise<RelayAppSettings>}
 */
async function saveAppSettings(userDataPath, patch) {
  const current = await loadAppSettings(userDataPath);
  const merged = normalize({
    version: 1,
    updates: { ...current.updates, ...(patch && patch.updates ? patch.updates : {}) },
    background: { ...current.background, ...(patch && patch.background ? patch.background : {}) },
  });
  const filePath = appSettingsFilePath(userDataPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(path.dirname(filePath), `relay-settings-${process.pid}-${randomUUID()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
  return merged;
}

module.exports = {
  appSettingsDefaults: defaults,
  appSettingsFilePath,
  loadAppSettings,
  normalizeAppSettings: normalize,
  saveAppSettings,
};

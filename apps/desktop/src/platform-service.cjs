"use strict";

// Centralized, typed platform logic. Every `process.platform` / `process.arch`
// branch in the main process should route through here so the rest of the code
// never hard-codes macOS-only (or Windows-only) assumptions.

const path = require("node:path");
const { execFile } = require("node:child_process");

/** @typedef {"mac" | "win" | "linux"} RelayPlatform */
/** @typedef {"arm64" | "x64" | "ia32" | "unknown"} RelayArch */

/** @returns {RelayPlatform} */
function currentPlatform() {
  switch (process.platform) {
    case "darwin":
      return "mac";
    case "win32":
      return "win";
    default:
      return "linux";
  }
}

/** @returns {RelayArch} */
function currentArch() {
  switch (process.arch) {
    case "arm64":
      return "arm64";
    case "x64":
      return "x64";
    case "ia32":
      return "ia32";
    default:
      return "unknown";
  }
}

const platform = currentPlatform();
const arch = currentArch();
const isMac = platform === "mac";
const isWindows = platform === "win";
const isLinux = platform === "linux";

/**
 * Human-readable descriptor used for release-asset selection and diagnostics.
 * @returns {{ platform: RelayPlatform; arch: RelayArch; label: string }}
 */
function describeTarget() {
  const platformLabel = isMac ? "macOS" : isWindows ? "Windows" : "Linux";
  const archLabel = arch === "arm64" ? "ARM64" : arch === "x64" ? "x64" : arch === "ia32" ? "x86" : arch;
  return { platform, arch, label: `${platformLabel} ${archLabel}` };
}

/**
 * Compares two paths using the semantics of the current filesystem. Windows and
 * macOS are case-insensitive; Linux is case-sensitive. Also normalizes
 * separators so a forward-slash path and a backslash path compare equal.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function pathsEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const normalizedA = path.normalize(a).replace(/[\\/]+$/, "");
  const normalizedB = path.normalize(b).replace(/[\\/]+$/, "");
  if (isLinux) return normalizedA === normalizedB;
  return normalizedA.localeCompare(normalizedB, undefined, { sensitivity: "accent" }) === 0;
}

/**
 * True when `child` is the same as, or nested inside, `parent`. Uses
 * filesystem-appropriate casing and never treats a sibling with a shared prefix
 * (e.g. `/a/foo` vs `/a/foobar`) as nested.
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
function pathContains(parent, child) {
  if (typeof parent !== "string" || typeof child !== "string") return false;
  const relative = path.relative(parent, child);
  if (relative === "") return true;
  if (relative.startsWith("..")) return false;
  return !path.isAbsolute(relative);
}

/**
 * Opens a directory in the platform's terminal. Uses Node/Electron-friendly
 * process spawning rather than assuming a specific shell exists.
 * @param {string} target absolute directory path
 * @returns {Promise<{ opened: boolean; error?: string }>}
 */
function openInTerminal(target) {
  return new Promise((resolve) => {
    /** @param {Error | null} error */
    const done = (error) => resolve(error === null ? { opened: true } : { opened: false, error: error.message });
    if (isMac) {
      execFile("open", ["-a", "Terminal", target], done);
    } else if (isWindows) {
      // `start` is a cmd builtin; the empty title arg guards against paths with spaces.
      execFile("cmd.exe", ["/c", "start", "", "cmd.exe", "/K", `cd /d "${target}"`], done);
    } else {
      execFile("x-terminal-emulator", [`--working-directory=${target}`], done);
    }
  });
}

module.exports = {
  arch,
  currentArch,
  currentPlatform,
  describeTarget,
  isLinux,
  isMac,
  isWindows,
  openInTerminal,
  pathContains,
  pathsEqual,
  platform,
};

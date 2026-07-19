// Vendored copy of integrations/core/src/canonical-path.ts for the Electron
// main process (CommonJS). Keep in sync with canonical-path.ts / .mjs — the
// core package owns a parity test that fails on drift.
const { realpathSync } = require("node:fs");
const { homedir } = require("node:os");
const { isAbsolute, resolve, sep } = require("node:path");

/** @param {string} value @returns {string} */
function stripTrailingSeparators(value) {
  let end = value.length;
  while (end > 1 && (value[end - 1] === "/" || value[end - 1] === "\\")) end -= 1;
  if (end === 2 && value[1] === ":") return `${value.slice(0, end)}${sep}`;
  return value.slice(0, end);
}

/** @param {string} input @param {string} home @returns {string} */
function expandHome(input, home) {
  if (input === "~") return home;
  if (input.startsWith("~/") || input.startsWith("~\\")) return resolve(home, input.slice(2));
  return input;
}

/** @param {NodeJS.Platform} platform @returns {boolean} */
function isCaseInsensitive(platform) {
  return platform === "darwin" || platform === "win32";
}

/**
 * @param {string} input
 * @param {{ platform?: NodeJS.Platform; home?: string; cwd?: string; realpath?: (value: string) => string }} [options]
 * @returns {{ path: string; key: string }}
 */
function canonicalizeRepositoryPath(input, options = {}) {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const realpath = options.realpath ?? realpathSync;

  const trimmed = typeof input === "string" ? input.trim() : "";
  if (trimmed === "") throw new Error("A repository path is required.");

  const expanded = expandHome(trimmed, home);
  const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  const withoutTrailing = stripTrailingSeparators(absolute);

  let resolved = withoutTrailing;
  try {
    resolved = stripTrailingSeparators(realpath(withoutTrailing));
  } catch {
    resolved = withoutTrailing;
  }

  const key = isCaseInsensitive(platform) ? resolved.toLowerCase() : resolved;
  return { path: resolved, key };
}

/**
 * @param {string} left
 * @param {string} right
 * @param {{ platform?: NodeJS.Platform; home?: string; cwd?: string; realpath?: (value: string) => string }} [options]
 * @returns {boolean}
 */
function sameRepositoryPath(left, right, options = {}) {
  return canonicalizeRepositoryPath(left, options).key === canonicalizeRepositoryPath(right, options).key;
}

module.exports = { canonicalizeRepositoryPath, sameRepositoryPath };

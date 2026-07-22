const { randomUUID } = require("node:crypto");
const { mkdir, readFile, rename, unlink, writeFile } = require("node:fs/promises");
const path = require("node:path");

const emptyWorkspace = Object.freeze({ directories: [], boards: [] });
const maxWorkspaceBytes = 10 * 1024 * 1024;

/**
 * @param {string} userDataPath
 * @returns {string}
 */
function workspaceDataFilePath(userDataPath) {
  return path.join(userDataPath, "relay-data", "workspace.json");
}

/**
 * @param {unknown} value
 * @returns {{ directories: unknown[]; boards: unknown[]; settings?: unknown; discoveries?: Record<string, any> }}
 */
function validateWorkspace(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Relay workspace data must be an object.");
  }
  const directories = "directories" in value ? value.directories : undefined;
  const boards = "boards" in value ? value.boards : undefined;
  if (!Array.isArray(directories) || !Array.isArray(boards)) {
    throw new Error("Relay workspace data must contain directory and board arrays.");
  }
  /** @type {{ directories: unknown[]; boards: unknown[]; settings?: unknown; discoveries?: Record<string, any> }} */
  const workspace = { directories, boards };
  if ("settings" in value && value.settings !== undefined) {
    workspace.settings = value.settings;
  }
  // Dropped silently before this line was added: every load and save round-
  // tripped through validateWorkspace without ever copying `discoveries`
  // across, so a freshly scanned index never survived being written to disk
  // — the very next read (e.g. the estimate step right after a scan) saw an
  // empty workspace and reported "No discovery index exists".
  if ("discoveries" in value && value.discoveries !== undefined) {
    workspace.discoveries = /** @type {Record<string, any>} */ (value.discoveries);
  }
  return workspace;
}

/**
 * @param {string} filePath
 * @returns {Promise<{ directories: unknown[]; boards: unknown[]; settings?: unknown; discoveries?: Record<string, any> }>}
 */
async function loadWorkspaceData(filePath) {
  try {
    const contents = await readFile(filePath, "utf8");
    return validateWorkspace(parseWorkspaceJson(contents));
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyWorkspace;
    }
    throw error;
  }
}

/**
 * @param {unknown} value
 * @param {string} filePath
 * @returns {Promise<{ directories: unknown[]; boards: unknown[]; settings?: unknown; discoveries?: Record<string, any> }>}
 */
async function saveWorkspaceData(value, filePath) {
  const workspace = validateWorkspace(value);
  const serialized = JSON.stringify(workspace, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > maxWorkspaceBytes) {
    throw new Error("Relay workspace data exceeds the 10 MB local limit.");
  }

  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `workspace-${process.pid}-${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return workspace;
}

/**
 * @param {string} contents
 * @returns {unknown}
 */
function parseWorkspaceJson(contents) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;

    const positionMatch = /after JSON at position (\d+)/.exec(error.message);
    if (positionMatch === null || positionMatch[1] === undefined) throw error;

    return JSON.parse(contents.slice(0, Number(positionMatch[1])));
  }
}

module.exports = {
  emptyWorkspace,
  loadWorkspaceData,
  parseWorkspaceJson,
  saveWorkspaceData,
  validateWorkspace,
  workspaceDataFilePath,
};

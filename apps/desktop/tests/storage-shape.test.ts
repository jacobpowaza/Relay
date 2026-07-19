import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  loadWorkspaceData,
  saveWorkspaceData,
  workspaceDataFilePath,
} = require("../src/workspace-storage.cjs");

describe("desktop workspace shape", () => {
  it("starts with no user data", () => {
    const workspace = { directories: [], boards: [] };

    expect(workspace.directories).toEqual([]);
    expect(workspace.boards).toEqual([]);
  });

  it("stores workspace data under the Electron userData directory", () => {
    const userDataPath = path.join("Users", "me", "Library", "Application Support", "Relay");

    expect(workspaceDataFilePath(userDataPath)).toBe(
      path.join(userDataPath, "relay-data", "workspace.json"),
    );
  });

  it("loads an empty workspace when the local data file does not exist", async () => {
    const localDataDirectory = await mkdtemp(path.join(tmpdir(), "relay-storage-"));
    const filePath = workspaceDataFilePath(localDataDirectory);

    await expect(loadWorkspaceData(filePath)).resolves.toEqual({ directories: [], boards: [] });
  });

  it("writes workspace data atomically to the app-owned local file", async () => {
    const localDataDirectory = await mkdtemp(path.join(tmpdir(), "relay-storage-"));
    const filePath = workspaceDataFilePath(localDataDirectory);
    const workspace = { directories: [{ id: "dir-1", name: "Local" }], boards: [] };

    await saveWorkspaceData(workspace, filePath);

    await expect(readFile(filePath, "utf8").then(JSON.parse)).resolves.toEqual(workspace);
  });

  it("preserves workspace settings when saving local data", async () => {
    const localDataDirectory = await mkdtemp(path.join(tmpdir(), "relay-storage-"));
    const filePath = workspaceDataFilePath(localDataDirectory);
    const workspace = {
      directories: [],
      boards: [],
      settings: { displayName: "Local User", performanceMode: true },
    };

    await saveWorkspaceData(workspace, filePath);

    await expect(loadWorkspaceData(filePath)).resolves.toEqual(workspace);
  });

  it("allows overlapping workspace saves to the same local file", async () => {
    const localDataDirectory = await mkdtemp(path.join(tmpdir(), "relay-storage-"));
    const filePath = workspaceDataFilePath(localDataDirectory);
    const workspaces = Array.from({ length: 12 }, (_, index) => ({
      directories: [{ id: `dir-${index}`, name: `Local ${index}` }],
      boards: [],
    }));

    await expect(Promise.all(workspaces.map((workspace) => saveWorkspaceData(workspace, filePath)))).resolves.toHaveLength(workspaces.length);

    const saved = JSON.parse(await readFile(filePath, "utf8"));
    expect(workspaces).toContainEqual(saved);
  });

  it("loads the first complete workspace when a previous file has trailing JSON", async () => {
    const localDataDirectory = await mkdtemp(path.join(tmpdir(), "relay-storage-"));
    const filePath = workspaceDataFilePath(localDataDirectory);
    const workspace = { directories: [{ id: "dir-1", name: "Local" }], boards: [] };

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(workspace)}${JSON.stringify({ stale: true })}`, "utf8");

    await expect(loadWorkspaceData(filePath)).resolves.toEqual(workspace);
  });
});

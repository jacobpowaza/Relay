import { mkdtemp, mkdir, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const discovery = require("../src/discovery.cjs");

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "relay-discovery-"));
  await mkdir(path.join(root, "src", "nested"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), "export function alpha() {}\n");
  await writeFile(path.join(root, "src", "nested", "b.ts"), 'import { alpha } from "../a";\nexport const beta = 1;\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Index {
  entries: Array<{ filePath: string; importantExports: string[]; contentHash: string; lastDiscovered: string; lastModified: string }>;
  features: Array<{ name: string; filePaths: string[] }>;
  discoveryCount: number;
  coverage: number;
}

async function discoverRepositoryOf(dir: string): Promise<Index> {
  return discovery.discoverRepository(dir) as Promise<Index>;
}

describe("walkDirectory", () => {
  it("keeps nested paths relative to the repo root, not the subdirectory", async () => {
    const files = await discovery.walkDirectory(root);
    const paths = files.map((f: { relativePath: string }) => f.relativePath);
    // Regression: recursion previously re-based each level, so this collapsed
    // to "b.ts" and collided with every other same-named file in the repo.
    expect(paths).toContain(path.join("src", "nested", "b.ts"));
    expect(paths).not.toContain("b.ts");
  });
});

describe("discoverRepository", () => {
  it("produces entries whose paths all resolve, with no duplicate keys", async () => {
    const index = await discoverRepositoryOf(root);
    const keys = index.entries.map((e) => e.filePath);
    expect(new Set(keys).size).toBe(keys.length);
    expect(index.discoveryCount).toBe(index.entries.length);
  });

  it("derives feature areas from the top-level path segment", async () => {
    const index = await discoverRepositoryOf(root);
    expect(index.features.map((f) => f.name)).toContain("src");
  });

  it("reports a fresh index as diffing clean", async () => {
    // The invariant that makes incremental discovery worthwhile: if a
    // just-built index reports changes, every scan re-inspects the whole repo.
    const index = await discoverRepositoryOf(root);
    const diff = await discovery.diffDiscovery(root, index.entries);
    expect(diff).toMatchObject({ changed: [], added: [], deleted: [] });
  });
});

describe("computeEntryStatus", () => {
  it("returns new for an unknown entry and stale for a vanished path", async () => {
    expect(await discovery.computeEntryStatus(root, undefined)).toBe("new");
    const ghost = {
      filePath: path.join("src", "gone.ts"),
      contentHash: "deadbeefdeadbeef",
      lastDiscovered: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };
    expect(await discovery.computeEntryStatus(root, ghost)).toBe("stale");
  });

  it("flags edited content as changed", async () => {
    const index = await discoverRepositoryOf(root);
    const target = path.join("src", "a.ts");
    await writeFile(path.join(root, target), "export function alpha() { return 1; }\n");
    const entry = index.entries.find((e) => e.filePath === target);
    expect(await discovery.computeEntryStatus(root, entry)).toBe("changed");
  });

  it("stays current when mtime moves but content is identical", async () => {
    const index = await discoverRepositoryOf(root);
    const target = path.join("src", "a.ts");
    const entry = index.entries.find((e) => e.filePath === target);
    // A touch or a revert must not be reported as a change, or agents burn
    // tokens re-reading files whose content never moved.
    await writeFile(path.join(root, target), "export function alpha() {}\n");
    expect(await discovery.computeEntryStatus(root, entry)).toBe("current");
  });
});

describe("buildEntry", () => {
  it("indexes a single file without walking the repository", async () => {
    const entry = await discovery.buildEntry(root, path.join("src", "a.ts"), { discoveredBy: "claude" });
    expect(entry).toMatchObject({ discoveredBy: "claude", confidence: "high" });
    expect(entry.importantExports).toContain("alpha");
  });

  it("returns null for an unreadable path so callers can treat it as a deletion", async () => {
    expect(await discovery.buildEntry(root, path.join("src", "missing.ts"))).toBeNull();
  });

  it("extracts CommonJS exports", async () => {
    await writeFile(path.join(root, "src", "c.cjs"), "function one() {}\nmodule.exports = { one, two: 2 };\n");
    const entry = await discovery.buildEntry(root, path.join("src", "c.cjs"));
    expect(entry.importantExports).toEqual(expect.arrayContaining(["one", "two"]));
  });
});

describe("incremental diff", () => {
  it("separates changed, added and deleted files", async () => {
    const index = await discoverRepositoryOf(root);
    await writeFile(path.join(root, "src", "a.ts"), "export function alpha() { return 2; }\n");
    await writeFile(path.join(root, "src", "c.ts"), "export class Gamma {}\n");
    await unlink(path.join(root, "src", "nested", "b.ts"));

    const diff = await discovery.diffDiscovery(root, index.entries);
    expect(diff.changed).toEqual([path.join("src", "a.ts")]);
    expect(diff.added).toEqual([path.join("src", "c.ts")]);
    expect(diff.deleted).toEqual([path.join("src", "nested", "b.ts")]);
  });

  it("ignores non-source files so they are not reported as perpetually added", async () => {
    const index = await discoverRepositoryOf(root);
    await writeFile(path.join(root, "notes.txt"), "not source\n");
    await writeFile(path.join(root, "Relay-1.0.0.dmg"), "binary\n");
    const diff = await discovery.diffDiscovery(root, index.entries);
    expect(diff.added).toEqual([]);
  });
});

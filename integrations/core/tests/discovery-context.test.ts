import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildDiscoveryContextPacket,
  deriveEntryChanges,
  selectRelevantEntries,
  type DiscoveryEntry,
  type DiscoveryIndex,
} from "../src/discovery.js";

/**
 * These cover the two things the hooks previously got wrong on their own:
 * change detection that trusted the stored `status`, and a relevance filter
 * that matched the task hint as one literal string.
 */

let repoRoot: string;

function hashOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

function writeFile(relPath: string, content: string, mtime?: Date): void {
  const full = path.join(repoRoot, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
  if (mtime !== undefined) utimesSync(full, mtime, mtime);
}

function entryFor(relPath: string, content: string, overrides: Partial<DiscoveryEntry> = {}): DiscoveryEntry {
  return {
    filePath: relPath,
    purpose: `Handles ${relPath}`,
    importantExports: [],
    relatedFiles: [],
    features: [],
    dependencies: [],
    lastModified: new Date().toISOString(),
    contentHash: hashOf(content),
    lastDiscovered: new Date().toISOString(),
    discoveredBy: "heuristic",
    confidence: "medium",
    status: "current",
    ...overrides,
  };
}

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(tmpdir(), "relay-discovery-ctx-"));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("deriveEntryChanges", () => {
  it("reports a file whose content changed even though the stored status says current", () => {
    const past = new Date(Date.now() - 60_000);
    writeFile("src/a.ts", "original", past);
    const entry = entryFor("src/a.ts", "original", { lastDiscovered: past.toISOString() });

    // Rewrite with different content and a newer mtime, as an edit would.
    writeFile("src/a.ts", "edited", new Date());

    const { changed, missing } = deriveEntryChanges(repoRoot, [entry]);
    expect(changed.map((e) => e.filePath)).toEqual(["src/a.ts"]);
    expect(missing).toEqual([]);
  });

  it("does not report a file that was touched but not modified", () => {
    const past = new Date(Date.now() - 60_000);
    writeFile("src/a.ts", "same", past);
    const entry = entryFor("src/a.ts", "same", { lastDiscovered: past.toISOString() });

    // Newer mtime defeats the cheap gate; the hash must still clear it.
    utimesSync(path.join(repoRoot, "src/a.ts"), new Date(), new Date());

    expect(deriveEntryChanges(repoRoot, [entry]).changed).toEqual([]);
  });

  it("separates entries whose file is gone from entries that changed", () => {
    writeFile("src/present.ts", "kept", new Date(Date.now() - 60_000));
    const present = entryFor("src/present.ts", "kept", {
      lastDiscovered: new Date(Date.now() - 60_000).toISOString(),
    });
    const absent = entryFor("src/gone.ts", "whatever");

    const { changed, missing } = deriveEntryChanges(repoRoot, [present, absent]);
    expect(changed).toEqual([]);
    expect(missing.map((e) => e.filePath)).toEqual(["src/gone.ts"]);
  });
});

describe("selectRelevantEntries", () => {
  const entries = [
    entryFor("integrations/core/src/discovery.ts", "x"),
    entryFor("apps/desktop/src/enrichment.cjs", "x", { features: ["core"] }),
    entryFor("apps/web/components/button.tsx", "x"),
  ];

  it("ranks by how many task words an entry matches, not by whole-string match", () => {
    const hint = "Consolidate duplicated hook discovery loaders onto integrations/core";
    const ranked = selectRelevantEntries(entries, hint);
    // The whole sentence appears in no entry; per-word matching is what makes
    // this return anything at all.
    expect(ranked[0]?.filePath).toBe("integrations/core/src/discovery.ts");
    expect(ranked.map((e) => e.filePath)).toContain("apps/desktop/src/enrichment.cjs");
  });

  it("ignores short filler words that would otherwise match everything", () => {
    expect(selectRelevantEntries(entries, "the to a of and")).toEqual([]);
  });

  it("honors the cap so a broad hint cannot dump the whole index", () => {
    const many = Array.from({ length: 40 }, (_, i) => entryFor(`src/discovery-${i}.ts`, "x"));
    expect(selectRelevantEntries(many, "discovery", 10)).toHaveLength(10);
  });
});

describe("buildDiscoveryContextPacket", () => {
  function indexOf(entries: DiscoveryEntry[]): DiscoveryIndex {
    return {
      repoPath: repoRoot,
      entries,
      features: [],
      lastFullDiscovery: new Date().toISOString(),
      coverage: 1,
      staleRelationshipCount: 0,
      discoveryCount: entries.length,
      version: 1,
    };
  }

  it("states that nothing changed rather than staying silent", () => {
    writeFile("src/a.ts", "same", new Date(Date.now() - 60_000));
    const entry = entryFor("src/a.ts", "same", {
      lastDiscovered: new Date(Date.now() - 60_000).toISOString(),
    });
    const packet = buildDiscoveryContextPacket(indexOf([entry]), { repoRoot });
    expect(packet).toContain("No files changed since last discovery.");
  });

  it("includes only hint-relevant entries when a task hint is given", () => {
    writeFile("src/auth.ts", "a", new Date(Date.now() - 60_000));
    writeFile("src/billing.ts", "b", new Date(Date.now() - 60_000));
    const discovered = new Date(Date.now() - 60_000).toISOString();
    const packet = buildDiscoveryContextPacket(
      indexOf([
        entryFor("src/auth.ts", "a", { lastDiscovered: discovered }),
        entryFor("src/billing.ts", "b", { lastDiscovered: discovered }),
      ]),
      { repoRoot, taskHint: "fix the authentication redirect" },
    );
    expect(packet).toContain("src/auth.ts");
    expect(packet).not.toContain("src/billing.ts");
  });

  it("omits the relevance section entirely when no hint is supplied", () => {
    writeFile("src/auth.ts", "a", new Date(Date.now() - 60_000));
    const packet = buildDiscoveryContextPacket(
      indexOf([entryFor("src/auth.ts", "a", { lastDiscovered: new Date(Date.now() - 60_000).toISOString() })]),
      { repoRoot },
    );
    expect(packet).not.toContain("Relevant entries for this task:");
  });
});

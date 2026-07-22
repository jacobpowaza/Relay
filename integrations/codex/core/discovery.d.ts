export interface DiscoveryEntry {
    filePath: string;
    purpose: string;
    importantExports: string[];
    relatedFiles: string[];
    features: string[];
    dependencies: string[];
    lastModified: string;
    contentHash: string;
    lastDiscovered: string;
    discoveredBy: string;
    confidence: "high" | "medium" | "low";
    status: "current" | "changed" | "new" | "stale" | "never";
}
export interface DiscoveryIndex {
    boardId?: string;
    repoPath: string;
    entries: DiscoveryEntry[];
    features: Array<{
        name: string;
        description: string;
        filePaths: string[];
    }>;
    lastFullDiscovery: string | null;
    coverage: number;
    staleRelationshipCount: number;
    discoveryCount: number;
    version: number;
}
/**
 * The one true normalization for `discoveries` map keys: trailing slashes
 * stripped, lowercased. Must stay identical to discoveryKey() in the desktop
 * main process and to the migration in apps/web/lib/storage.ts.
 *
 * Exported as a shared helper because the rule was previously copy-pasted into
 * four places and one copy drifted: session-end.mjs wrote back under the RAW
 * path, so on any repo path containing an uppercase letter it created a second,
 * orphaned entry that nothing ever read — while the real index silently kept
 * its stale hashes. Callers must use this rather than re-deriving it.
 */
export declare function discoveryKey(repoPath: string): string;
export declare function loadDiscoveryFromWorkspace(workspacePath: string, repoPath: string): DiscoveryIndex | null;
/**
 * Splits entries into those whose file changed since indexing and those whose
 * file is gone.
 *
 * Status is DERIVED here, never read from the entry. The persisted `status` is
 * written at index time and is meaningless afterwards — every entry reads
 * "current" the moment it is written, so pre-filtering on it discarded exactly
 * the changed files this is meant to surface.
 *
 * The mtime comparison gates the hash so an index of thousands of entries does
 * not cost a full re-hash of the repo on every session start; the hash still
 * has the final say, so a touched-but-unmodified file is not reported.
 */
export declare function deriveEntryChanges(repoRoot: string, entries: DiscoveryEntry[]): {
    changed: DiscoveryEntry[];
    missing: DiscoveryEntry[];
};
export declare function buildDiscoveryContextPacket(discovery: DiscoveryIndex, options: {
    repoRoot: string;
    taskHint?: string;
}): string;
/**
 * Picks the entries worth showing for a task description, capped at `limit`.
 *
 * Matching is per-token rather than on the whole string: a task hint is a
 * sentence ("wire the discovery UI to real agents"), and asking whether a
 * purpose contains that entire sentence matches nothing.
 *
 * Tokens match on a shared prefix rather than equality, because the vocabulary
 * on the two sides is rarely identical — a task says "authentication" while the
 * file is `auth.ts`, or says "discovery" while the feature is "discoveries".
 * Requiring an exact hit made the filter silently return nothing in exactly the
 * cases it was added for.
 */
export declare function selectRelevantEntries(entries: DiscoveryEntry[], taskHint: string, limit?: number): DiscoveryEntry[];
export declare function buildDiscoveryLine(repoRoot: string, discovery: DiscoveryIndex | null): string;
//# sourceMappingURL=discovery.d.ts.map
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
export declare function loadDiscoveryFromWorkspace(workspacePath: string, repoPath: string): DiscoveryIndex | null;
export declare function buildDiscoveryContextPacket(discovery: DiscoveryIndex, options: {
    repoRoot: string;
    taskHint?: string;
}): string;
export declare function buildDiscoveryLine(repoRoot: string, discovery: DiscoveryIndex | null): string;
//# sourceMappingURL=discovery.d.ts.map
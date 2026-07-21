import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
export function loadDiscoveryFromWorkspace(workspacePath, boardId) {
    if (!existsSync(workspacePath))
        return null;
    try {
        const raw = JSON.parse(readFileSync(workspacePath, "utf8"));
        const board = (raw.boards ?? []).find((b) => b.id === boardId);
        return board?.discovery ?? null;
    }
    catch {
        return null;
    }
}
export function buildDiscoveryContextPacket(discovery, options) {
    const { repoRoot, taskHint } = options;
    const entries = discovery.entries;
    const features = discovery.features;
    const now = Date.now();
    const changedEntries = entries.filter((e) => {
        if (e.status !== "changed")
            return false;
        const fullPath = resolve(repoRoot, e.filePath);
        if (!existsSync(fullPath))
            return false;
        try {
            const content = readFileSync(fullPath, "utf8");
            const currentHash = createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
            return currentHash !== e.contentHash;
        }
        catch {
            return false;
        }
    });
    const lastScan = discovery.lastFullDiscovery
        ? `${Math.round((now - new Date(discovery.lastFullDiscovery).getTime()) / 86400000)} days ago`
        : "never";
    const parts = [
        `Project discovery is available.`,
        ``,
        `Last full discovery: ${lastScan}`,
        `${discovery.discoveryCount} files indexed`,
        `${features.length} feature areas identified`,
        `${changedEntries.length} files changed since discovery`,
    ];
    if (changedEntries.length > 0) {
        parts.push(``, `Changed files that need re-inspection:`);
        for (const entry of changedEntries.slice(0, 15)) {
            parts.push(`  - ${entry.filePath} (${entry.purpose})`);
        }
        if (changedEntries.length > 15) {
            parts.push(`  ... and ${changedEntries.length - 15} more`);
        }
        parts.push(``, `Read these changed files first. Use stored discovery data for unchanged files.`);
    }
    const minuteThreshold = 30 * 24 * 60 * 60 * 1000;
    const staleEntries = entries.filter((e) => {
        const discovered = new Date(e.lastDiscovered).getTime();
        const modified = new Date(e.lastModified).getTime();
        return modified > discovered || (now - discovered) > minuteThreshold;
    });
    if (staleEntries.length > 0) {
        parts.push(``, `Note: ${staleEntries.length} entries may be stale (modified after last discovery or discovered >30 days ago).`);
    }
    parts.push(``, `Use Relay Discovery as the project's cached understanding. Do not re-read unchanged files unless the current task requires exact implementation details missing from discovery.`);
    if (taskHint) {
        const taskLower = taskHint.toLowerCase();
        const relevantEntries = entries.filter((e) => e.purpose.toLowerCase().includes(taskLower) ||
            e.features.some((f) => f.toLowerCase().includes(taskLower)) ||
            e.importantExports.some((exp) => exp.toLowerCase().includes(taskLower)) ||
            e.filePath.toLowerCase().includes(taskLower)).slice(0, 10);
        if (relevantEntries.length > 0) {
            parts.push(``, `Relevant discovery entries for this task:`);
            for (const entry of relevantEntries) {
                parts.push(`  ${entry.filePath} — ${entry.purpose}`);
            }
        }
    }
    return parts.join("\n");
}
export function buildDiscoveryLine(repoRoot, discovery) {
    if (!discovery)
        return "No discovery data. Run Discover Project to enable incremental indexing.";
    const rootName = repoRoot.split("/").pop() ?? repoRoot;
    const changedCount = discovery.entries.filter((e) => e.status === "changed").length;
    const status = changedCount > 0
        ? `${changedCount} file${changedCount > 1 ? "s" : ""} changed since last scan`
        : "all files current";
    return `${rootName} · ${discovery.discoveryCount} files · ${discovery.features.length} features · ${status}`;
}

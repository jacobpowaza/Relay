import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
export function loadDiscoveryFromWorkspace(workspacePath, repoPath) {
    if (!existsSync(workspacePath))
        return null;
    try {
        const raw = JSON.parse(readFileSync(workspacePath, "utf8"));
        // Keys are normalized (resolved, trailing slash stripped, lowercased) by
        // discoveryKey() in the desktop main process. Match that or lookups miss
        // when the caller's cwd casing differs from the indexed path.
        const key = repoPath.replace(/\/+$/, "").toLowerCase();
        const direct = raw.discoveries?.[key] ?? raw.discoveries?.[repoPath];
        if (direct !== undefined)
            return direct;
        // Fallback: board-level discovery, for boards predating the map.
        const board = (raw.boards ?? []).find((b) => b.repository === repoPath);
        return board?.discovery ?? null;
    }
    catch {
        return null;
    }
}
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
export function deriveEntryChanges(repoRoot, entries) {
    const changed = [];
    const missing = [];
    for (const entry of entries) {
        const fullPath = resolve(repoRoot, entry.filePath);
        if (!existsSync(fullPath)) {
            missing.push(entry);
            continue;
        }
        try {
            const discoveredAt = new Date(entry.lastDiscovered).getTime();
            if (Number.isFinite(discoveredAt) && statSync(fullPath).mtimeMs <= discoveredAt)
                continue;
            const content = readFileSync(fullPath, "utf8");
            const currentHash = createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
            if (currentHash !== entry.contentHash)
                changed.push(entry);
        }
        catch {
            // Unreadable mid-session; treat as unchanged rather than guessing.
        }
    }
    return { changed, missing };
}
export function buildDiscoveryContextPacket(discovery, options) {
    const { repoRoot, taskHint } = options;
    const entries = discovery.entries;
    const features = discovery.features;
    const now = Date.now();
    const { changed: changedEntries, missing: missingEntries } = deriveEntryChanges(repoRoot, entries);
    const lastScan = discovery.lastFullDiscovery
        ? `${Math.round((now - new Date(discovery.lastFullDiscovery).getTime()) / 86400000)} days ago`
        : "never";
    // Terse on purpose. This packet is injected into every session start, so
    // each line of prose here is a cost paid on every session forever.
    const parts = [
        `--- Relay Discovery ---`,
        `Last full discovery: ${lastScan}`,
        `${discovery.discoveryCount} files indexed`,
        `${features.length} feature areas`,
    ];
    if (changedEntries.length > 0) {
        parts.push(`${changedEntries.length} files changed since discovery:`);
        for (const entry of changedEntries.slice(0, 10)) {
            parts.push(`  ${entry.filePath} — ${entry.purpose}`);
        }
        if (changedEntries.length > 10)
            parts.push(`  ... and ${changedEntries.length - 10} more`);
        parts.push(`Read changed files first. Use stored discovery for unchanged files.`);
    }
    else {
        parts.push(`No files changed since last discovery.`);
    }
    // Acting on a stored summary for a file that no longer exists is worse than
    // having no entry at all, so say it — but a count is enough, the paths are
    // not actionable.
    if (missingEntries.length > 0) {
        parts.push(`${missingEntries.length} indexed file(s) no longer exist; those entries are stale.`);
    }
    const staleThreshold = 30 * 24 * 60 * 60 * 1000;
    const staleEntries = entries.filter((e) => {
        const discovered = new Date(e.lastDiscovered).getTime();
        const modified = new Date(e.lastModified).getTime();
        return modified > discovered || (now - discovered) > staleThreshold;
    });
    if (staleEntries.length > 0) {
        parts.push(`${staleEntries.length} entries may be stale (modified after discovery, or discovered >30 days ago).`);
    }
    parts.push(`Use Relay Discovery as cached repo understanding. Do not re-read unchanged files unless the task requires implementation detail missing from discovery.`);
    parts.push(`Check this index before opening a file. Read the file itself only when you need detail the summary does not carry.`);
    // The point of the hint: hand back the handful of entries relevant to the
    // task instead of the whole index, which is what makes this cheaper than
    // letting the agent grep the repo from scratch.
    if (taskHint !== undefined && taskHint.trim() !== "") {
        const relevant = selectRelevantEntries(entries, taskHint);
        if (relevant.length > 0) {
            parts.push(`Relevant entries for this task:`);
            for (const entry of relevant)
                parts.push(`  ${entry.filePath} — ${entry.purpose}`);
        }
    }
    parts.push(`---`);
    return parts.join("\n");
}
function tokenize(text) {
    // Four characters minimum: "the"/"to"/"and" match everything and rank
    // nothing. Splitting on non-alphanumerics also breaks camelCase paths apart
    // at the separators that matter (src/auth-token.ts -> src, auth, token).
    return [...new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])];
}
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
export function selectRelevantEntries(entries, taskHint, limit = 10) {
    const hintTokens = tokenize(taskHint);
    if (hintTokens.length === 0)
        return [];
    const scored = entries
        .map((entry) => {
        const entryTokens = tokenize([entry.filePath, entry.purpose, ...entry.features, ...entry.importantExports].join(" "));
        // Score by distinct hint tokens hit, so an entry cannot inflate its rank
        // by repeating one word across its path, purpose and features.
        const score = hintTokens.filter((hintToken) => entryTokens.some((entryToken) => entryToken.startsWith(hintToken) || hintToken.startsWith(entryToken))).length;
        return { entry, score };
    })
        .filter((candidate) => candidate.score > 0);
    scored.sort((a, b) => b.score - a.score || a.entry.filePath.localeCompare(b.entry.filePath));
    return scored.slice(0, limit).map((candidate) => candidate.entry);
}
export function buildDiscoveryLine(repoRoot, discovery) {
    if (!discovery)
        return "No discovery data. Run Discover Project to enable incremental indexing.";
    const rootName = repoRoot.split("/").pop() ?? repoRoot;
    // Derived, not the stored status, which always reads "current". See
    // deriveEntryChanges: filtering on e.status here reported 0 changed forever.
    const changedCount = deriveEntryChanges(repoRoot, discovery.entries).changed.length;
    const status = changedCount > 0
        ? `${changedCount} file${changedCount > 1 ? "s" : ""} changed since last scan`
        : "all files current";
    return `${rootName} · ${discovery.discoveryCount} files · ${discovery.features.length} features · ${status}`;
}

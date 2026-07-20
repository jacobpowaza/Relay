import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve, sep } from "node:path";
function stripTrailingSeparators(value) {
    let end = value.length;
    while (end > 1 && (value[end - 1] === "/" || value[end - 1] === "\\"))
        end -= 1;
    // Preserve a Windows drive root like `C:\` and POSIX root `/`.
    if (end === 2 && value[1] === ":")
        return `${value.slice(0, end)}${sep}`;
    return value.slice(0, end);
}
function expandHome(input, home) {
    if (input === "~")
        return home;
    if (input.startsWith("~/") || input.startsWith("~\\"))
        return resolve(home, input.slice(2));
    return input;
}
function isCaseInsensitive(platform) {
    return platform === "darwin" || platform === "win32";
}
/**
 * Canonicalize a repository path into a stable {@link CanonicalRepositoryPath}.
 * Never throws for a missing target: if the path does not exist yet, the
 * lexically-resolved absolute path is used (symlink resolution is best effort).
 */
export function canonicalizeRepositoryPath(input, options = {}) {
    const platform = options.platform ?? process.platform;
    const home = options.home ?? homedir();
    const cwd = options.cwd ?? process.cwd();
    const realpath = options.realpath ?? realpathSync;
    const trimmed = typeof input === "string" ? input.trim() : "";
    if (trimmed === "")
        throw new Error("A repository path is required.");
    const expanded = expandHome(trimmed, home);
    const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
    const withoutTrailing = stripTrailingSeparators(absolute);
    let resolved = withoutTrailing;
    try {
        resolved = stripTrailingSeparators(realpath(withoutTrailing));
    }
    catch {
        // Path does not exist yet (or is not resolvable); keep the lexical absolute path.
        resolved = withoutTrailing;
    }
    const key = isCaseInsensitive(platform) ? resolved.toLowerCase() : resolved;
    return { path: resolved, key };
}
/** True when two repository paths resolve to the same canonical identity. */
export function sameRepositoryPath(left, right, options = {}) {
    return canonicalizeRepositoryPath(left, options).key === canonicalizeRepositoryPath(right, options).key;
}

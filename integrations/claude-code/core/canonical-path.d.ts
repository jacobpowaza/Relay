/**
 * The single source of truth for turning any repository path a user, agent, or
 * plugin might supply into one stable identity. Relay (desktop + core) and every
 * integration script MUST route directory/board matching through this so that
 * `~`, relative paths, trailing slashes, symlinks, and platform case differences
 * never produce duplicate or mismatched directories.
 */
export interface CanonicalRepositoryPath {
    /** Canonical absolute path, symlink-resolved when the target exists, no trailing separator. */
    path: string;
    /** Comparison key: {@link path} lowercased on case-insensitive platforms (darwin/win32). */
    key: string;
}
export interface CanonicalizeOptions {
    platform?: NodeJS.Platform;
    home?: string;
    /** Base directory used to resolve relative inputs. Defaults to `process.cwd()`. */
    cwd?: string;
    /** Injectable for tests. Returns the symlink-resolved path or throws if it cannot resolve. */
    realpath?: (value: string) => string;
}
/**
 * Canonicalize a repository path into a stable {@link CanonicalRepositoryPath}.
 * Never throws for a missing target: if the path does not exist yet, the
 * lexically-resolved absolute path is used (symlink resolution is best effort).
 */
export declare function canonicalizeRepositoryPath(input: string, options?: CanonicalizeOptions): CanonicalRepositoryPath;
/** True when two repository paths resolve to the same canonical identity. */
export declare function sameRepositoryPath(left: string, right: string, options?: CanonicalizeOptions): boolean;
//# sourceMappingURL=canonical-path.d.ts.map
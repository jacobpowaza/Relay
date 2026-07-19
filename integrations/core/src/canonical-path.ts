import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve, sep } from "node:path";

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

function stripTrailingSeparators(value: string): string {
  let end = value.length;
  while (end > 1 && (value[end - 1] === "/" || value[end - 1] === "\\")) end -= 1;
  // Preserve a Windows drive root like `C:\` and POSIX root `/`.
  if (end === 2 && value[1] === ":") return `${value.slice(0, end)}${sep}`;
  return value.slice(0, end);
}

function expandHome(input: string, home: string): string {
  if (input === "~") return home;
  if (input.startsWith("~/") || input.startsWith("~\\")) return resolve(home, input.slice(2));
  return input;
}

function isCaseInsensitive(platform: NodeJS.Platform): boolean {
  return platform === "darwin" || platform === "win32";
}

/**
 * Canonicalize a repository path into a stable {@link CanonicalRepositoryPath}.
 * Never throws for a missing target: if the path does not exist yet, the
 * lexically-resolved absolute path is used (symlink resolution is best effort).
 */
export function canonicalizeRepositoryPath(
  input: string,
  options: CanonicalizeOptions = {},
): CanonicalRepositoryPath {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const realpath = options.realpath ?? realpathSync;

  const trimmed = typeof input === "string" ? input.trim() : "";
  if (trimmed === "") throw new Error("A repository path is required.");

  const expanded = expandHome(trimmed, home);
  const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  const withoutTrailing = stripTrailingSeparators(absolute);

  let resolved = withoutTrailing;
  try {
    resolved = stripTrailingSeparators(realpath(withoutTrailing));
  } catch {
    // Path does not exist yet (or is not resolvable); keep the lexical absolute path.
    resolved = withoutTrailing;
  }

  const key = isCaseInsensitive(platform) ? resolved.toLowerCase() : resolved;
  return { path: resolved, key };
}

/** True when two repository paths resolve to the same canonical identity. */
export function sameRepositoryPath(
  left: string,
  right: string,
  options: CanonicalizeOptions = {},
): boolean {
  return canonicalizeRepositoryPath(left, options).key === canonicalizeRepositoryPath(right, options).key;
}

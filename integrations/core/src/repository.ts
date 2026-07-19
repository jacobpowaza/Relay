import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import type { RepositoryIdentity } from "./protocol.js";

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }).trim();
  } catch {
    return undefined;
  }
}

function lines(value: string | undefined): string[] {
  return value === undefined || value === "" ? [] : value.split(/\r?\n/).filter(Boolean);
}

export function detectRepositoryIdentity(cwd = process.cwd()): RepositoryIdentity {
  const workingDirectory = realpathSync(resolve(cwd));
  const root = git(workingDirectory, ["rev-parse", "--show-toplevel"]);
  const repositoryRoot = root === undefined ? workingDirectory : realpathSync(root);
  const status = lines(git(repositoryRoot, ["status", "--porcelain=v1"]));
  const stagedFiles = status
    .filter((line) => line[0] !== " " && line[0] !== "?")
    .map((line) => line.slice(3).trim());
  const changedFiles = status.map((line) => line.slice(3).trim());
  const remoteUrl = git(repositoryRoot, ["config", "--get", "remote.origin.url"]);
  const branch = git(repositoryRoot, ["branch", "--show-current"]);
  const baseBranch = git(repositoryRoot, ["rev-parse", "--abbrev-ref", "origin/HEAD"]);
  const headCommit = git(repositoryRoot, ["rev-parse", "HEAD"]);
  const worktree = git(repositoryRoot, ["rev-parse", "--git-common-dir"]);

  return {
    root: repositoryRoot,
    workingDirectory,
    ...(remoteUrl === undefined ? {} : { remoteUrl }),
    ...(branch === undefined ? {} : { branch }),
    ...(baseBranch === undefined ? {} : { baseBranch }),
    ...(headCommit === undefined ? {} : { headCommit }),
    dirty: status.length > 0,
    changedFiles,
    stagedFiles,
    ...(worktree === undefined ? {} : { worktree }),
  };
}

const { execFile } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { mkdtemp, realpath, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const maxDiffBytes = 2 * 1024 * 1024;
const intentLifetimeMilliseconds = 10 * 60 * 1_000;

/** @typedef {{ exitCode: number; stderr: string; stdout: string }} GitResult */
/** @typedef {{ allowedExitCodes?: number[]; env?: NodeJS.ProcessEnv; maxBuffer?: number; timeout?: number }} GitRunOptions */
/** @typedef {{ level: "artifact" | "secret"; reason: string }} GitRisk */
/** @typedef {{ path: string; originalPath?: string | undefined; status?: string | undefined; stagedStatus?: string | undefined; modifiedStatus?: string | undefined; untracked?: boolean | undefined; conflicted?: boolean | undefined; kind?: string | undefined }} GitEntry */
/** @typedef {{ additions: number; binary: boolean; deletions: number; kind: string; modifiedStatus: string | undefined; originalPath: string | undefined; patch: string; path: string; reviewable: boolean; reviewError: string | undefined; risks: GitRisk[]; stagedStatus: string | undefined; state: string; tracked: boolean }} GitFile */
/** @typedef {{ id: string; message: string; files: GitFile[] }} ValidatedCommit */

class GitWorkflowError extends Error {
  /** @param {string} code @param {string} message @param {Record<string, unknown>} [details] */
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GitWorkflowError";
    this.code = code;
    this.details = details;
  }
}

/** @param {GitResult} result @param {string} fallback */
function commandError(result, fallback) {
  const message = result.stderr.trim() || result.stdout.trim() || fallback;
  return new GitWorkflowError("GIT_COMMAND_FAILED", message, { exitCode: result.exitCode });
}

// Count of git child processes currently in flight. Every git invocation is a
// short-lived execFile with windowsHide + a hard timeout, so this only ever
// reflects genuinely active work — useful for the dev diagnostics panel.
let inFlightGitProcesses = 0;

/** @returns {number} */
function activeGitProcessCount() {
  return inFlightGitProcesses;
}

/** @param {string} repositoryRoot @param {string[]} args @param {GitRunOptions} [options] @returns {Promise<GitResult>} */
function runGit(repositoryRoot, args, options = {}) {
  const allowedExitCodes = options.allowedExitCodes ?? [0];
  return new Promise((resolve, reject) => {
    inFlightGitProcesses += 1;
    execFile("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_EDITOR: "true",
        GIT_TERMINAL_PROMPT: "0",
        ...options.env,
      },
      maxBuffer: options.maxBuffer ?? maxDiffBytes,
      timeout: options.timeout ?? 15_000,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      inFlightGitProcesses = Math.max(0, inFlightGitProcesses - 1);
      const exitCode = error === null ? 0 : typeof error.code === "number" ? error.code : -1;
      const result = { exitCode, stdout: stdout ?? "", stderr: stderr ?? "" };
      if (allowedExitCodes.includes(exitCode)) resolve(result);
      else reject(commandError(result, error instanceof Error ? error.message : "Git command failed."));
    });
  });
}

/** @param {string} repositoryRoot @param {string[]} args @param {GitRunOptions} [options] @returns {Promise<string | null>} */
async function optionalGit(repositoryRoot, args, options = {}) {
  try {
    return (await runGit(repositoryRoot, args, options)).stdout.trim();
  } catch {
    return null;
  }
}

/** @param {string} value @returns {string[]} */
function nulTokens(value) {
  const tokens = value.split("\0");
  if (tokens.at(-1) === "") tokens.pop();
  return tokens;
}

/** @param {string} value @returns {GitEntry[]} */
function parseNameStatus(value) {
  const tokens = nulTokens(value);
  /** @type {GitEntry[]} */
  const entries = [];
  for (let index = 0; index < tokens.length;) {
    const statusToken = tokens[index++];
    if (statusToken === undefined) break;
    const status = statusToken[0] ?? "M";
    if (status === "R" || status === "C") {
      const originalPath = tokens[index++];
      const nextPath = tokens[index++];
      if (originalPath !== undefined && nextPath !== undefined) entries.push({ path: nextPath, originalPath, status });
    } else {
      const entryPath = tokens[index++];
      if (entryPath !== undefined) entries.push({ path: entryPath, status });
    }
  }
  return entries;
}

/** @param {string} filePath @returns {GitRisk[]} */
function pathRiskReasons(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const basename = path.posix.basename(normalized).toLowerCase();
  /** @type {GitRisk[]} */
  const reasons = [];
  if (
    basename === ".env"
    || basename.startsWith(".env.")
    || /\.(?:key|p12|pfx|pem)$/i.test(basename)
    || /(?:credential|private[_-]?key|secret)/i.test(basename)
  ) reasons.push({ level: "secret", reason: "The filename commonly contains credentials or private key material." });
  if (
    /(^|\/)(?:\.next|build|coverage|dist|node_modules|out|target|vendor)(\/|$)/i.test(normalized)
    || /\.(?:class|dll|dmg|exe|o|obj|pyc|so)$/i.test(basename)
  ) reasons.push({ level: "artifact", reason: "The path looks like generated output or a build artifact." });
  return reasons;
}

/** @param {string} patch @returns {GitRisk[]} */
function addedContentRisk(patch) {
  const addedLines = patch.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).join("\n");
  if (/(?:api[_-]?key|client[_-]?secret|password|private[_-]?key|token)\s*[:=]\s*["']?[A-Za-z0-9_+/.=-]{12,}/i.test(addedLines)) {
    return [{ level: "secret", reason: "Added lines resemble a credential, token, password, or private key assignment." }];
  }
  return [];
}

/** @param {string} value */
function parseNumstat(value) {
  const [line = ""] = value.split(/\r?\n/);
  const [added = "0", deleted = "0"] = line.split("\t");
  return {
    additions: added === "-" ? 0 : Number.parseInt(added, 10) || 0,
    binary: added === "-" || deleted === "-",
    deletions: deleted === "-" ? 0 : Number.parseInt(deleted, 10) || 0,
  };
}

/** @param {string} repositoryRoot @param {string} baseRef @param {GitEntry & { kind: string }} entry */
async function fileDiff(repositoryRoot, baseRef, entry) {
  const paths = entry.originalPath === undefined ? [entry.path] : [entry.originalPath, entry.path];
  const args = entry.kind === "untracked"
    ? ["diff", "--no-index", "--no-ext-diff", "--", "/dev/null", entry.path]
    : ["diff", "--no-ext-diff", "--find-renames", baseRef, "--", ...paths];
  const numstatArgs = entry.kind === "untracked"
    ? ["diff", "--no-index", "--numstat", "--", "/dev/null", entry.path]
    : ["diff", "--numstat", "--find-renames", baseRef, "--", ...paths];
  try {
    const [patchResult, statResult] = await Promise.all([
      runGit(repositoryRoot, args, { allowedExitCodes: entry.kind === "untracked" ? [0, 1] : [0] }),
      runGit(repositoryRoot, numstatArgs, { allowedExitCodes: entry.kind === "untracked" ? [0, 1] : [0] }),
    ]);
    const patch = patchResult.stdout;
    return { patch, reviewable: true, ...parseNumstat(statResult.stdout), risks: addedContentRisk(patch) };
  } catch (error) {
    return {
      additions: 0,
      binary: false,
      deletions: 0,
      patch: "",
      reviewable: false,
      reviewError: error instanceof Error ? error.message : "The diff is too large to review safely in Relay.",
      risks: [],
    };
  }
}

/** @param {GitEntry[]} stagedEntries @param {GitEntry[]} modifiedEntries @param {string[]} untrackedPaths @param {string[]} conflictedPaths @returns {Array<GitEntry & { kind: string }>} */
function combineEntries(stagedEntries, modifiedEntries, untrackedPaths, conflictedPaths) {
  /** @type {Map<string, GitEntry>} */
  const map = new Map();
  for (const entry of stagedEntries) map.set(entry.path, { ...entry, stagedStatus: entry.status });
  for (const entry of modifiedEntries) {
    const current = map.get(entry.path) ?? { path: entry.path };
    map.set(entry.path, { ...current, ...entry, modifiedStatus: entry.status });
  }
  for (const entryPath of untrackedPaths) map.set(entryPath, { path: entryPath, untracked: true });
  for (const entryPath of conflictedPaths) {
    const current = map.get(entryPath) ?? { path: entryPath };
    map.set(entryPath, { ...current, conflicted: true });
  }
  return [...map.values()].map((entry) => ({
    ...entry,
    kind: entry.conflicted
      ? "conflicted"
      : entry.untracked
        ? "untracked"
        : entry.stagedStatus !== undefined && entry.modifiedStatus !== undefined
          ? "staged_modified"
          : entry.stagedStatus !== undefined ? "staged" : "modified",
  })).sort((left, right) => left.path.localeCompare(right.path));
}

/** @param {GitEntry & { kind: string }} entry */
function fileState(entry) {
  if (entry.conflicted) return "conflicted";
  if (entry.untracked) return "untracked";
  const status = entry.modifiedStatus ?? entry.stagedStatus ?? entry.status ?? "M";
  if (status === "A" || status === "C") return "added";
  if (status === "D") return "deleted";
  if (status === "R") return "renamed";
  return "modified";
}

/** @param {string} candidatePath @returns {Promise<string>} */
async function resolveRepository(candidatePath) {
  if (typeof candidatePath !== "string" || !path.isAbsolute(candidatePath)) {
    throw new GitWorkflowError("REPOSITORY_NOT_LINKED", "This board is not linked to a local repository.");
  }
  const canonicalCandidate = await realpath(candidatePath).catch(() => null);
  if (canonicalCandidate === null) throw new GitWorkflowError("REPOSITORY_NOT_FOUND", "The linked repository directory no longer exists.");
  const rootOutput = await optionalGit(canonicalCandidate, ["rev-parse", "--show-toplevel"]);
  if (rootOutput === null) throw new GitWorkflowError("NOT_A_GIT_REPOSITORY", "The linked directory is not inside a Git repository.");
  const repositoryRoot = await realpath(rootOutput);
  if (canonicalCandidate !== repositoryRoot && !canonicalCandidate.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new GitWorkflowError("REPOSITORY_MISMATCH", "The linked directory does not resolve inside the detected repository.");
  }
  return repositoryRoot;
}

/** @param {string} candidatePath */
async function readRepositoryStatus(candidatePath) {
  const repositoryRoot = await resolveRepository(candidatePath);
  const [branch, head, staged, modified, untracked, conflicted, remotes, upstream] = await Promise.all([
    optionalGit(repositoryRoot, ["branch", "--show-current"]),
    optionalGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"]),
    runGit(repositoryRoot, ["diff", "--cached", "--name-status", "-z", "--find-renames"]).then((result) => result.stdout),
    runGit(repositoryRoot, ["diff", "--name-status", "-z", "--find-renames"]).then((result) => result.stdout),
    runGit(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"]).then((result) => nulTokens(result.stdout)),
    runGit(repositoryRoot, ["diff", "--name-only", "--diff-filter=U", "-z"]).then((result) => nulTokens(result.stdout)),
    runGit(repositoryRoot, ["remote"]).then((result) => result.stdout.split(/\r?\n/).filter(Boolean)),
    optionalGit(repositoryRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
  ]);
  const combined = combineEntries(parseNameStatus(staged), parseNameStatus(modified), untracked, conflicted);
  const files = combined.map((entry) => ({
      additions: 0,
      binary: false,
      deletions: 0,
      kind: entry.kind,
      modifiedStatus: entry.modifiedStatus,
      originalPath: entry.originalPath,
      patch: "",
      path: entry.path,
      reviewable: entry.kind !== "conflicted",
      reviewError: entry.kind === "conflicted" ? "Resolve this conflict outside Relay before committing." : undefined,
      risks: pathRiskReasons(entry.path),
      stagedStatus: entry.stagedStatus,
      state: fileState(entry),
      tracked: entry.kind !== "untracked",
    }));
  const remote = upstream?.includes("/") ? upstream.slice(0, upstream.indexOf("/")) : remotes.includes("origin") ? "origin" : remotes[0] ?? null;
  const remoteUrl = remote === null ? null : await optionalGit(repositoryRoot, ["config", "--get", `remote.${remote}.url`]);
  const fingerprintPayload = files.map(({ kind, path: filePath, stagedStatus, modifiedStatus, state }) => ({ kind, path: filePath, stagedStatus, modifiedStatus, state }));
  const snapshotId = createHash("sha256").update(JSON.stringify({ branch, head, files: fingerprintPayload })).digest("hex");
  return {
    branch: branch || null,
    canPush: Boolean(branch && remote),
    files: files.map((file) => ({
      additions: file.additions,
      binary: file.binary,
      deletions: file.deletions,
      kind: file.kind,
      modifiedStatus: file.modifiedStatus,
      originalPath: file.originalPath,
      patch: file.patch,
      path: file.path,
      reviewable: file.reviewable,
      reviewError: file.reviewError,
      risks: file.risks,
      stagedStatus: file.stagedStatus,
      state: file.state,
      tracked: file.tracked,
    })),
    head,
    pushUnavailableReason: !branch ? "Check out a branch before pushing." : remote === null ? "Add a Git remote before pushing." : null,
    remote,
    remoteUrl,
    repositoryRoot,
    snapshotId,
  };
}

/** @param {Awaited<ReturnType<typeof readRepositoryStatus>>} status @param {GitFile} file */
async function enrichFile(status, file) {
  const baseRef = status.head ?? emptyTree;
  const diff = await fileDiff(status.repositoryRoot, baseRef, file);
  const workingHash = await optionalGit(status.repositoryRoot, ["hash-object", "--no-filters", "--", file.path]);
  return {
    ...file,
    ...diff,
    risks: [...pathRiskReasons(file.path), ...diff.risks],
    patchHash: createHash("sha256").update(diff.patch).digest("hex"),
    workingHash: workingHash ?? "deleted",
  };
}

/** @param {Awaited<ReturnType<typeof readRepositoryStatus>>} status @param {string[]} paths */
async function enrichFiles(status, paths) {
  const byPath = new Map(status.files.map((file) => [file.path, file]));
  /** @type {Array<GitFile & { patchHash: string; workingHash: string }>} */
  const enriched = [];
  for (let offset = 0; offset < paths.length; offset += 8) {
    const batch = paths.slice(offset, offset + 8).map((filePath) => {
      const file = byPath.get(filePath);
      if (file === undefined) throw new GitWorkflowError("WORKTREE_CHANGED", `The path ${filePath} is no longer part of the working tree status.`);
      return enrichFile(status, file);
    });
    enriched.push(...await Promise.all(batch));
  }
  return enriched;
}

/** @param {string} candidatePath @param {string} filePath */
async function readWorkingTreeDiff(candidatePath, filePath) {
  if (typeof filePath !== "string" || filePath.trim() === "") throw new GitWorkflowError("INVALID_GIT_PATH", "Choose a changed file to review its diff.");
  const status = await readRepositoryStatus(candidatePath);
  const [file] = await enrichFiles(status, [filePath]);
  if (file === undefined) throw new GitWorkflowError("WORKTREE_CHANGED", `The path ${filePath} is no longer part of the working tree status.`);
  return {
    additions: file.additions,
    binary: file.binary,
    deletions: file.deletions,
    kind: file.kind,
    modifiedStatus: file.modifiedStatus,
    originalPath: file.originalPath,
    patch: file.patch,
    path: file.path,
    reviewable: file.reviewable,
    reviewError: file.reviewError,
    risks: file.risks,
    stagedStatus: file.stagedStatus,
    state: file.state,
    tracked: file.tracked,
  };
}

/** @param {Array<GitFile & { patchHash: string; workingHash: string }>} files */
function selectionSnapshot(files) {
  return createHash("sha256").update(JSON.stringify(files.map((file) => ({
    path: file.path,
    patchHash: file.patchHash,
    workingHash: file.workingHash,
  })))).digest("hex");
}

/** @param {string} candidatePath @param {number} limit */
async function readCommitHistory(candidatePath, limit = 100) {
  const repositoryRoot = await resolveRepository(candidatePath);
  const safeLimit = Number.isInteger(limit) ? Math.min(250, Math.max(1, limit)) : 100;
  const output = await optionalGit(repositoryRoot, ["log", `-${safeLimit}`, "--date=iso-strict", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1f%D%x1e"]);
  if (output === null || output === "") return [];
  return output.split("\x1e").map((record) => record.trim()).filter(Boolean).map((record) => {
    const [hash = "", parents = "", authorName = "", authorEmail = "", authoredAt = "", subject = "", body = "", refs = ""] = record.split("\x1f");
    return { hash, parents: parents.split(" ").filter(Boolean), authorName, authorEmail, authoredAt, subject, body: body.trim(), refs: refs.split(", ").filter(Boolean) };
  });
}

/** @param {string} repositoryRoot @param {unknown} value @param {string} label */
async function requireCommit(repositoryRoot, value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{7,40}$/i.test(value)) throw new GitWorkflowError("INVALID_COMMIT", `Choose a valid ${label} commit.`);
  const resolved = await optionalGit(repositoryRoot, ["rev-parse", "--verify", `${value}^{commit}`]);
  if (resolved === null) throw new GitWorkflowError("INVALID_COMMIT", `The ${label} commit is no longer available in this repository.`);
  return resolved;
}

/** @param {string} candidatePath @param {unknown} base @param {unknown} head */
async function compareCommits(candidatePath, base, head) {
  const repositoryRoot = await resolveRepository(candidatePath);
  const [baseHash, headHash] = await Promise.all([
    requireCommit(repositoryRoot, base, "base"),
    requireCommit(repositoryRoot, head, "comparison"),
  ]);
  const changed = await runGit(repositoryRoot, ["diff", "--name-status", "-z", "--find-renames", baseHash, headHash]);
  const files = parseNameStatus(changed.stdout).map((entry) => ({
    additions: 0,
    binary: false,
    deletions: 0,
    originalPath: entry.originalPath,
    path: entry.path,
    patch: "",
    reviewable: true,
    risks: [],
    state: fileState({ ...entry, kind: "history" }),
  }));
  return { base: baseHash, head: headHash, files };
}

/** @param {string} candidatePath @param {unknown} base @param {unknown} head @param {unknown} filePath */
async function readCommitDiff(candidatePath, base, head, filePath) {
  const repositoryRoot = await resolveRepository(candidatePath);
  if (typeof filePath !== "string" || filePath.trim() === "") throw new GitWorkflowError("INVALID_GIT_PATH", "Choose a changed file to review its diff.");
  const [baseHash, headHash] = await Promise.all([
    requireCommit(repositoryRoot, base, "base"),
    requireCommit(repositoryRoot, head, "comparison"),
  ]);
  const patchResult = await runGit(repositoryRoot, ["diff", "--no-ext-diff", "--find-renames", baseHash, headHash, "--", filePath]);
  const statResult = await runGit(repositoryRoot, ["diff", "--numstat", "--find-renames", baseHash, headHash, "--", filePath]);
  return { path: filePath, patch: patchResult.stdout, reviewable: true, risks: [], ...parseNumstat(statResult.stdout) };
}

/** @param {string} value */
function shellQuote(value) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** @param {string[]} args */
function commandLine(args) {
  return ["git", ...args].map(shellQuote).join(" ");
}

/** @param {Awaited<ReturnType<typeof readRepositoryStatus>>} status @param {any} input @returns {ValidatedCommit[]} */
function validateCommitSelections(status, input) {
  if (input === null || typeof input !== "object") throw new GitWorkflowError("INVALID_COMMIT_PLAN", "The commit plan is missing.");
  if (input.snapshotId !== status.snapshotId) throw new GitWorkflowError("WORKTREE_CHANGED", "The working tree changed. Refresh the panel and review the updated files before committing.");
  if (!Array.isArray(input.commits) || input.commits.length === 0 || input.commits.length > 20) {
    throw new GitWorkflowError("INVALID_COMMIT_PLAN", "Create between 1 and 20 non-empty commits.");
  }
  const acknowledged = new Set(Array.isArray(input.acknowledgedRiskPaths) ? input.acknowledgedRiskPaths : []);
  const filesByPath = new Map(status.files.map((file) => [file.path, file]));
  const assigned = new Set();
  return input.commits.map((/** @type {any} */ commit, /** @type {number} */ index) => {
    const message = typeof commit?.message === "string" ? commit.message.trim() : "";
    if (message === "" || message.length > 5_000) throw new GitWorkflowError("INVALID_COMMIT_MESSAGE", `Commit ${index + 1} needs a message of 5,000 characters or fewer.`);
    if (!Array.isArray(commit?.paths) || commit.paths.length === 0 || commit.paths.length > 500) {
      throw new GitWorkflowError("INVALID_COMMIT_PLAN", `Commit ${index + 1} must contain between 1 and 500 files.`);
    }
    const files = commit.paths.map((/** @type {unknown} */ filePath) => {
      if (typeof filePath !== "string" || assigned.has(filePath)) throw new GitWorkflowError("DUPLICATE_COMMIT_PATH", `The path ${String(filePath)} is assigned more than once.`);
      const file = filesByPath.get(filePath);
      if (file === undefined) throw new GitWorkflowError("WORKTREE_CHANGED", `The path ${filePath} is no longer part of the reviewed status.`);
      if (file.kind === "conflicted") throw new GitWorkflowError("UNRESOLVED_CONFLICT", `Resolve the conflict in ${filePath} before committing.`);
      if (!file.reviewable) throw new GitWorkflowError("DIFF_NOT_REVIEWABLE", `${filePath} cannot be committed in Relay because its complete diff could not be displayed.`);
      if (file.risks.length > 0 && !acknowledged.has(filePath)) throw new GitWorkflowError("RISK_NOT_ACKNOWLEDGED", `Review and explicitly acknowledge the warning for ${filePath}.`);
      assigned.add(filePath);
      return file;
    });
    return { id: typeof commit.id === "string" ? commit.id : `commit-${index + 1}`, message, files };
  });
}

function createGitWorkflow() {
  /** @type {Map<string, any>} */
  const intents = new Map();

  /** @param {string} candidatePath @param {any} input */
  async function prepare(candidatePath, input) {
    const status = await readRepositoryStatus(candidatePath);
    if (input?.snapshotId !== status.snapshotId) throw new GitWorkflowError("WORKTREE_CHANGED", "The working tree changed. Refresh the panel and review the updated files before committing.");
    const selectedPaths = Array.isArray(input?.commits)
      ? [...new Set(input.commits.flatMap((/** @type {any} */ commit) => Array.isArray(commit?.paths) ? commit.paths : []).filter((/** @type {unknown} */ filePath) => typeof filePath === "string"))]
      : [];
    const enrichedFiles = await enrichFiles(status, selectedPaths);
    const enrichedByPath = new Map(enrichedFiles.map((file) => [file.path, file]));
    const reviewStatus = { ...status, files: status.files.map((file) => enrichedByPath.get(file.path) ?? file) };
    const commits = validateCommitSelections(reviewStatus, input);
    const confirmationToken = randomUUID();
    const plan = {
      branch: status.branch,
      canPush: status.canPush,
      commits: commits.map((/** @type {ValidatedCommit} */ commit) => ({
        id: commit.id,
        message: commit.message,
        files: commit.files.map((/** @type {GitFile} */ file) => ({ additions: file.additions, deletions: file.deletions, kind: file.kind, path: file.path, risks: file.risks })),
        commands: [commandLine(["add", "--all", "--", ...commit.files.map((/** @type {GitFile} */ file) => file.path)]), commandLine(["commit", "--message", commit.message])],
      })),
      confirmationToken,
      expiresAt: new Date(Date.now() + intentLifetimeMilliseconds).toISOString(),
      head: status.head,
      remote: status.remote,
      remoteUrl: status.remoteUrl,
      repositoryRoot: status.repositoryRoot,
    };
    intents.set(confirmationToken, { candidatePath, commits, createdAt: Date.now(), selectedPaths, selectionSnapshot: selectionSnapshot(enrichedFiles), status });
    return plan;
  }

  /** @param {string} confirmationToken @param {boolean} push */
  async function execute(confirmationToken, push) {
    const intent = intents.get(confirmationToken);
    if (intent === undefined || Date.now() - intent.createdAt > intentLifetimeMilliseconds) {
      intents.delete(confirmationToken);
      throw new GitWorkflowError("CONFIRMATION_EXPIRED", "This commit review expired. Refresh and review the working tree again.");
    }
    if (push === true && !intent.status.canPush) throw new GitWorkflowError("PUSH_UNAVAILABLE", intent.status.pushUnavailableReason ?? "Push is unavailable.");
    const current = await readRepositoryStatus(intent.candidatePath);
    const currentSelectedFiles = await enrichFiles(current, intent.selectedPaths);
    if (current.head !== intent.status.head || selectionSnapshot(currentSelectedFiles) !== intent.selectionSnapshot) {
      intents.delete(confirmationToken);
      throw new GitWorkflowError("WORKTREE_CHANGED", "The working tree changed after review. Nothing was committed; refresh and confirm the new plan.");
    }
    intents.delete(confirmationToken);

    /** @type {{ branch: string | null; commands: string[]; commits: Array<{ files: string[]; hash: string; message: string }>; errors: string[]; push: null | { output: string; success: boolean }; remote: string | null; remoteUrl: string | null; success: boolean; warnings: string[] }} */
    const result = {
      branch: current.branch,
      commands: [],
      commits: [],
      errors: [],
      push: null,
      remote: current.remote,
      remoteUrl: current.remoteUrl,
      success: false,
      warnings: [],
    };

    for (const [index, commit] of intent.commits.entries()) {
      const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "relay-git-index-"));
      const indexPath = path.join(temporaryDirectory, "index");
      const env = { GIT_INDEX_FILE: indexPath };
      try {
        const head = await optionalGit(current.repositoryRoot, ["rev-parse", "--verify", "HEAD"]);
        const readTreeArgs = head === null ? ["read-tree", "--empty"] : ["read-tree", "HEAD"];
        result.commands.push(commandLine(readTreeArgs));
        await runGit(current.repositoryRoot, readTreeArgs, { env });
        const paths = commit.files.map((/** @type {GitFile} */ file) => file.path);
        const addArgs = ["add", "--all", "--", ...paths];
        result.commands.push(commandLine(addArgs));
        await runGit(current.repositoryRoot, addArgs, { env, timeout: 60_000 });
        const check = await runGit(current.repositoryRoot, ["diff", "--cached", "--check"], { env, allowedExitCodes: [0, 2] });
        if (check.stdout.trim() !== "") result.warnings.push(check.stdout.trim());
        const quiet = await runGit(current.repositoryRoot, ["diff", "--cached", "--quiet"], { env, allowedExitCodes: [0, 1] });
        if (quiet.exitCode === 0) throw new GitWorkflowError("EMPTY_COMMIT", `Commit ${index + 1} no longer contains a change.`);
        const commitArgs = ["commit", "--message", commit.message];
        result.commands.push(commandLine(commitArgs));
        await runGit(current.repositoryRoot, commitArgs, { env, timeout: 60_000 });
        const hash = (await runGit(current.repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim();
        const resetArgs = ["reset", "--quiet", "HEAD", "--", ...paths];
        result.commands.push(commandLine(resetArgs));
        await runGit(current.repositoryRoot, resetArgs);
        result.commits.push({ files: paths, hash, message: commit.message });
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : `Commit ${index + 1} failed.`);
        break;
      } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
      }
    }

    if (result.errors.length === 0 && push === true) {
      if (current.remote === null || current.branch === null) throw new GitWorkflowError("PUSH_UNAVAILABLE", current.pushUnavailableReason ?? "Push is unavailable.");
      const upstream = await optionalGit(current.repositoryRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
      const pushArgs = upstream === null
        ? ["push", "--set-upstream", current.remote, current.branch]
        : ["push", current.remote, `HEAD:refs/heads/${current.branch}`];
      result.commands.push(commandLine(pushArgs));
      try {
        const pushResult = await runGit(current.repositoryRoot, pushArgs, { timeout: 120_000 });
        result.push = { output: [pushResult.stdout.trim(), pushResult.stderr.trim()].filter(Boolean).join("\n"), success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Push failed.";
        result.errors.push(message);
        result.push = { output: message, success: false };
      }
    }
    result.success = result.errors.length === 0;
    return result;
  }

  /** @param {string} candidatePath */
  async function push(candidatePath) {
    const status = await readRepositoryStatus(candidatePath);
    if (!status.canPush || status.remote === null || status.branch === null) throw new GitWorkflowError("PUSH_UNAVAILABLE", status.pushUnavailableReason ?? "Push is unavailable.");
    const upstream = await optionalGit(status.repositoryRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
    const pushArgs = upstream === null
      ? ["push", "--set-upstream", status.remote, status.branch]
      : ["push", status.remote, `HEAD:refs/heads/${status.branch}`];
    /** @type {{ branch: string; commands: string[]; commits: Array<{ files: string[]; hash: string; message: string }>; errors: string[]; push: null | { output: string; success: boolean }; remote: string; remoteUrl: string | null; success: boolean; warnings: string[] }} */
    const result = {
      branch: status.branch,
      commands: [commandLine(pushArgs)],
      commits: [],
      errors: [],
      push: null,
      remote: status.remote,
      remoteUrl: status.remoteUrl,
      success: false,
      warnings: [],
    };
    try {
      const pushed = await runGit(status.repositoryRoot, pushArgs, { timeout: 120_000 });
      result.push = { output: [pushed.stdout.trim(), pushed.stderr.trim()].filter(Boolean).join("\n"), success: true };
      result.success = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Push failed.";
      result.errors.push(message);
      result.push = { output: message, success: false };
    }
    return result;
  }

  return {
    activeProcessCount: activeGitProcessCount,
    compare: compareCommits,
    compareDiff: readCommitDiff,
    diff: readWorkingTreeDiff,
    execute,
    history: readCommitHistory,
    prepare,
    push,
    status: readRepositoryStatus,
  };
}

module.exports = {
  GitWorkflowError,
  createGitWorkflow,
  compareCommits,
  parseNameStatus,
  pathRiskReasons,
  readCommitDiff,
  readCommitHistory,
  readRepositoryStatus,
  readWorkingTreeDiff,
  resolveRepository,
};

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  createGitWorkflow,
  pathRiskReasons,
  readRepositoryStatus,
} = require("../src/git-workflow.cjs");

function git(repository: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
}

async function repositoryFixture(): Promise<string> {
  const repository = await mkdtemp(path.join(tmpdir(), "relay-git-workflow-"));
  git(repository, ["init", "-b", "main"]);
  git(repository, ["config", "user.name", "Relay Test"]);
  git(repository, ["config", "user.email", "relay@example.test"]);
  await writeFile(path.join(repository, "alpha.txt"), "alpha\n", "utf8");
  await writeFile(path.join(repository, "beta.txt"), "beta\n", "utf8");
  await writeFile(path.join(repository, "staged.txt"), "base\n", "utf8");
  git(repository, ["add", "--all"]);
  git(repository, ["commit", "-m", "Initial commit"]);
  return repository;
}

describe("desktop Git workflow", () => {
  it("classifies tracked, staged, untracked, secret, and artifact changes", async () => {
    const repository = await repositoryFixture();
    await writeFile(path.join(repository, "alpha.txt"), "alpha changed\n", "utf8");
    await writeFile(path.join(repository, "staged.txt"), "staged changed\n", "utf8");
    git(repository, ["add", "staged.txt"]);
    await writeFile(path.join(repository, ".env.local"), "API_TOKEN=abcdefghijklmnop\n", "utf8");
    await mkdir(path.join(repository, "dist"));
    await writeFile(path.join(repository, "dist", "bundle.js"), "generated\n", "utf8");

    const status = await readRepositoryStatus(repository);

    expect(status.files.find((file: { path: string }) => file.path === "alpha.txt")).toMatchObject({ kind: "modified", tracked: true });
    expect(status.files.find((file: { path: string }) => file.path === "staged.txt")).toMatchObject({ kind: "staged", tracked: true });
    expect(status.files.find((file: { path: string }) => file.path === ".env.local")).toMatchObject({ kind: "untracked", tracked: false });
    expect(status.files.find((file: { path: string }) => file.path === ".env.local").risks).toContainEqual(expect.objectContaining({ level: "secret" }));
    expect(status.files.find((file: { path: string }) => file.path === "dist/bundle.js").risks).toContainEqual(expect.objectContaining({ level: "artifact" }));
  });

  it("returns status metadata first and loads a selected file diff on demand", async () => {
    const repository = await repositoryFixture();
    await writeFile(path.join(repository, "alpha.txt"), "alpha changed\n", "utf8");
    const workflow = createGitWorkflow();

    const status = await workflow.status(repository);
    const alpha = status.files.find((file: { path: string }) => file.path === "alpha.txt");
    const diff = await workflow.diff(repository, "alpha.txt");

    expect(alpha).toMatchObject({ patch: "", state: "modified" });
    expect(diff.patch).toContain("+alpha changed");
    expect(diff).toMatchObject({ additions: 1, deletions: 1, reviewable: true });
  });

  it("excludes ignored files from status and rejects them from commit plans", async () => {
    const repository = await repositoryFixture();
    await writeFile(path.join(repository, ".gitignore"), "ignored.log\nignored-dir/\n", "utf8");
    await writeFile(path.join(repository, "ignored.log"), "local output\n", "utf8");
    await mkdir(path.join(repository, "ignored-dir"));
    await writeFile(path.join(repository, "ignored-dir", "cache.txt"), "cache\n", "utf8");
    await writeFile(path.join(repository, "visible.log"), "reviewed output\n", "utf8");
    const workflow = createGitWorkflow();
    const status = await workflow.status(repository);
    const paths = status.files.map((file: { path: string }) => file.path);

    expect(paths).toContain("visible.log");
    expect(paths).not.toContain("ignored.log");
    expect(paths).not.toContain("ignored-dir/cache.txt");
    await expect(workflow.prepare(repository, {
      acknowledgedRiskPaths: [],
      commits: [{ id: "ignored", message: "Add ignored output", paths: ["ignored.log"] }],
      snapshotId: status.snapshotId,
    })).rejects.toMatchObject({ code: "WORKTREE_CHANGED" });

    const plan = await workflow.prepare(repository, {
      acknowledgedRiskPaths: [],
      commits: [{ id: "visible", message: "Add visible output", paths: ["visible.log"] }],
      snapshotId: status.snapshotId,
    });
    const result = await workflow.execute(plan.confirmationToken, false);

    expect(result).toMatchObject({ success: true });
    expect(git(repository, ["show", "--format=", "--name-only", "HEAD"])).toBe("visible.log");
    expect(git(repository, ["status", "--short", "--ignored"])).toContain("!! ignored.log");
    expect(git(repository, ["status", "--short", "--ignored"])).toContain("!! ignored-dir/");
  });

  it("lists commit history and compares any two commits", async () => {
    const repository = await repositoryFixture();
    const initialHash = git(repository, ["rev-parse", "HEAD"]);
    await writeFile(path.join(repository, "alpha.txt"), "alpha changed\n", "utf8");
    await writeFile(path.join(repository, "new.txt"), "new file\n", "utf8");
    git(repository, ["add", "--all"]);
    git(repository, ["commit", "-m", "Update alpha", "-m", "Add the supporting file."]);
    const nextHash = git(repository, ["rev-parse", "HEAD"]);
    const workflow = createGitWorkflow();

    const history = await workflow.history(repository, 10);
    const comparison = await workflow.compare(repository, initialHash, nextHash);
    const diff = await workflow.compareDiff(repository, initialHash, nextHash, "alpha.txt");

    expect(history[0]).toMatchObject({ hash: nextHash, subject: "Update alpha", body: "Add the supporting file." });
    expect(comparison.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "alpha.txt", state: "modified" }),
      expect.objectContaining({ path: "new.txt", state: "added" }),
    ]));
    expect(diff.patch).toContain("+alpha changed");
  });

  it("creates separate exact commits while preserving unrelated staged work", async () => {
    const repository = await repositoryFixture();
    await writeFile(path.join(repository, "alpha.txt"), "alpha changed\n", "utf8");
    await writeFile(path.join(repository, "beta.txt"), "beta changed\n", "utf8");
    await writeFile(path.join(repository, "staged.txt"), "staged for later\n", "utf8");
    git(repository, ["add", "staged.txt"]);
    await writeFile(path.join(repository, "extra.txt"), "not selected\n", "utf8");
    const workflow = createGitWorkflow();
    const status = await workflow.status(repository);
    const plan = await workflow.prepare(repository, {
      acknowledgedRiskPaths: [],
      commits: [
        { id: "alpha", message: "Update alpha", paths: ["alpha.txt"] },
        { id: "beta", message: "Update beta", paths: ["beta.txt"] },
      ],
      snapshotId: status.snapshotId,
    });

    const result = await workflow.execute(plan.confirmationToken, false);

    expect(result).toMatchObject({ success: true, branch: "main" });
    expect(result.commits.map((commit: { message: string }) => commit.message)).toEqual(["Update alpha", "Update beta"]);
    expect(git(repository, ["log", "-2", "--format=%s"]).split("\n")).toEqual(["Update beta", "Update alpha"]);
    expect(git(repository, ["diff", "--cached", "--name-only"])).toBe("staged.txt");
    expect(git(repository, ["status", "--short"])).toContain("?? extra.txt");
  });

  it("cancels a reviewed plan when file content changes", async () => {
    const repository = await repositoryFixture();
    await writeFile(path.join(repository, "alpha.txt"), "first version\n", "utf8");
    const workflow = createGitWorkflow();
    const status = await workflow.status(repository);
    const plan = await workflow.prepare(repository, {
      acknowledgedRiskPaths: [],
      commits: [{ id: "alpha", message: "Update alpha", paths: ["alpha.txt"] }],
      snapshotId: status.snapshotId,
    });
    await writeFile(path.join(repository, "alpha.txt"), "second version\n", "utf8");

    await expect(workflow.execute(plan.confirmationToken, false)).rejects.toMatchObject({ code: "WORKTREE_CHANGED" });
    expect(git(repository, ["log", "-1", "--format=%s"])).toBe("Initial commit");
  });

  it("requires explicit acknowledgement before preparing risky paths", async () => {
    const repository = await repositoryFixture();
    await writeFile(path.join(repository, ".env"), "PASSWORD=abcdefghijklmnop\n", "utf8");
    const workflow = createGitWorkflow();
    const status = await workflow.status(repository);

    await expect(workflow.prepare(repository, {
      acknowledgedRiskPaths: [],
      commits: [{ id: "secrets", message: "Add environment", paths: [".env"] }],
      snapshotId: status.snapshotId,
    })).rejects.toMatchObject({ code: "RISK_NOT_ACKNOWLEDGED" });
  });

  it("flags sensitive paths without reading credential values into warnings", () => {
    expect(pathRiskReasons("config/private-key.pem")).toEqual([
      expect.objectContaining({ level: "secret" }),
    ]);
  });

  it("pushes the current branch without creating a commit", async () => {
    const repository = await repositoryFixture();
    const remote = await mkdtemp(path.join(tmpdir(), "relay-git-remote-"));
    git(remote, ["init", "--bare"]);
    git(repository, ["remote", "add", "origin", remote]);
    const workflow = createGitWorkflow();

    const result = await workflow.push(repository);

    expect(result).toMatchObject({ success: true, commits: [], push: { success: true } });
    expect(git(remote, ["rev-parse", "refs/heads/main"])).toBe(git(repository, ["rev-parse", "HEAD"]));
  });
});

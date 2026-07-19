import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { detectRepositoryIdentity } from "../src/repository.js";

describe("detectRepositoryIdentity", () => {
  it("detects git root, branch, and dirty files", () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-repo-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "relay@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Relay"], { cwd: dir });
    execFileSync("git", ["commit", "--allow-empty", "-m", "initial"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "https://example.com/relay.git"], { cwd: dir });
    execFileSync("node", ["-e", "require('fs').writeFileSync('changed.txt', 'x')"], { cwd: dir });

    const identity = detectRepositoryIdentity(dir);

    expect(identity.root).toBe(realpathSync(dir));
    expect(identity.branch).toBe("main");
    expect(identity.remoteUrl).toBe("https://example.com/relay.git");
    expect(identity.dirty).toBe(true);
    expect(identity.changedFiles).toContain("changed.txt");
  });
});

import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { canonicalizeRepositoryPath, sameRepositoryPath } from "../src/canonical-path.js";

const home = "/Users/example";

describe("canonicalizeRepositoryPath", () => {
  it("expands a bare ~ to the home directory", () => {
    expect(canonicalizeRepositoryPath("~", { home, platform: "linux" }).path).toBe(home);
  });

  it("expands ~/project to an absolute home path", () => {
    expect(canonicalizeRepositoryPath("~/dev/relay", { home, platform: "linux" }).path).toBe(`${home}/dev/relay`);
  });

  it("treats ~ and the full home path as the same identity", () => {
    expect(sameRepositoryPath("~/dev/relay", `${home}/dev/relay`, { home, platform: "linux" })).toBe(true);
  });

  it("resolves relative paths against cwd", () => {
    const result = canonicalizeRepositoryPath("relay", { home, platform: "linux", cwd: "/Users/example/dev" });
    expect(result.path).toBe("/Users/example/dev/relay");
  });

  it("strips trailing slashes", () => {
    expect(sameRepositoryPath("/a/b/", "/a/b", { platform: "linux" })).toBe(true);
    expect(sameRepositoryPath("/a/b///", "/a/b", { platform: "linux" })).toBe(true);
  });

  it("preserves the POSIX root", () => {
    expect(canonicalizeRepositoryPath("/", { platform: "linux" }).path).toBe("/");
  });

  it("keeps case in the path but folds case in the key on darwin", () => {
    const result = canonicalizeRepositoryPath("/Users/Example/Relay", { platform: "darwin" });
    expect(result.path).toBe("/Users/Example/Relay");
    expect(result.key).toBe("/users/example/relay");
    expect(sameRepositoryPath("/Users/Example/Relay", "/users/example/relay", { platform: "darwin" })).toBe(true);
  });

  it("does not fold case on linux", () => {
    expect(sameRepositoryPath("/A/B", "/a/b", { platform: "linux" })).toBe(false);
  });

  it("resolves symlinks so a link and its target share identity", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "relay-canon-")));
    const target = join(base, "real-repo");
    const link = join(base, "link-repo");
    mkdirSync(target, { recursive: true });
    symlinkSync(target, link);
    expect(sameRepositoryPath(link, target, { platform: process.platform })).toBe(true);
  });

  it("falls back to the lexical path when the target does not exist", () => {
    const result = canonicalizeRepositoryPath("/does/not/exist/ever", { platform: "linux" });
    expect(result.path).toBe("/does/not/exist/ever");
  });

  it("rejects empty input", () => {
    expect(() => canonicalizeRepositoryPath("   ", { home })).toThrow();
  });
});

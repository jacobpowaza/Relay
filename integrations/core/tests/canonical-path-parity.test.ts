import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { canonicalizeRepositoryPath } from "../src/canonical-path.js";
// @ts-expect-error -- vendored JS copy shipped beside the standalone plugin scripts
import { canonicalizeRepositoryPath as vendoredClaudeImport } from "../../claude-code/scripts/canonical-path.mjs";
// @ts-expect-error -- vendored JS copy shipped beside the standalone plugin scripts
import { canonicalizeRepositoryPath as vendoredCodexImport } from "../../codex/scripts/canonical-path.mjs";

// The vendored copies have no type declarations; assert they match the core
// signature so the parity assertions stay type-checked.
const vendoredClaude = vendoredClaudeImport as typeof canonicalizeRepositoryPath;
const vendoredCodex = vendoredCodexImport as typeof canonicalizeRepositoryPath;

const here = dirname(fileURLToPath(import.meta.url));
const claudePath = join(here, "..", "..", "claude-code", "scripts", "canonical-path.mjs");
const codexPath = join(here, "..", "..", "codex", "scripts", "canonical-path.mjs");
const desktopPath = join(here, "..", "..", "..", "apps", "desktop", "src", "canonical-path.cjs");

const cases: Array<[string, Parameters<typeof canonicalizeRepositoryPath>[1]]> = [
  ["~/dev/relay", { home: "/Users/x", platform: "linux" }],
  ["~", { home: "/Users/x", platform: "linux" }],
  ["relay", { home: "/Users/x", platform: "linux", cwd: "/Users/x/dev" }],
  ["/a/b///", { platform: "linux" }],
  ["/Users/Example/Relay", { platform: "darwin" }],
  ["/A/B", { platform: "linux" }],
  ["/does/not/exist/ever", { platform: "linux" }],
];

describe("canonical-path vendored parity", () => {
  it("claude-code + codex vendored copies match the core implementation", () => {
    for (const [input, options] of cases) {
      const expected = canonicalizeRepositoryPath(input, options);
      expect(vendoredClaude(input, options)).toEqual(expected);
      expect(vendoredCodex(input, options)).toEqual(expected);
    }
  });

  it("claude-code + codex vendored source files are byte-identical", () => {
    expect(readFileSync(claudePath, "utf8")).toBe(readFileSync(codexPath, "utf8"));
  });

  it("the desktop CJS copy exposes the same core logic body", () => {
    // Guard: the desktop copy must keep the same option-injection surface so it
    // canonicalizes identically to the TS/MJS versions.
    const desktopSource = readFileSync(desktopPath, "utf8");
    expect(desktopSource).toContain("function canonicalizeRepositoryPath");
    expect(desktopSource).toContain("isCaseInsensitive");
    expect(desktopSource).toContain("stripTrailingSeparators");
    expect(desktopSource).toContain("module.exports = { canonicalizeRepositoryPath, sameRepositoryPath }");
  });
});

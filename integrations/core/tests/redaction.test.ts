import { describe, expect, it } from "vitest";

import { redactSecrets, shouldIgnorePath } from "../src/redaction.js";

describe("redactSecrets", () => {
  it("redacts token-looking values and env assignments", () => {
    const result = redactSecrets("OPENAI_API_KEY=sk-abc12345678901234567890\ntext ghp_abcdefghijklmnopqrstuvwxyz"); // gitleaks:allow

    expect(result.redacted).not.toContain("sk-abc");
    expect(result.redacted).not.toContain("ghp_");
    expect(result.findings.map((finding) => finding.kind)).toContain("env_assignment");
  });

  it("flags sensitive paths", () => {
    expect(shouldIgnorePath("/repo/.env.local")).toBe(true);
    expect(shouldIgnorePath("src/index.ts")).toBe(false);
  });
});

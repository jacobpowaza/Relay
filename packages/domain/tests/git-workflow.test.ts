import { describe, expect, it } from "vitest";

import { suggestCommit } from "../src/git-workflow.js";

describe("Git commit suggestions", () => {
  it("describes a focused desktop and web change", () => {
    expect(suggestCommit([
      { additions: 20, deletions: 2, path: "apps/desktop/src/git-service.cjs", status: "A" },
      { additions: 12, deletions: 1, path: "apps/web/components/git-commit-panel.tsx", status: "A" },
    ])).toEqual({
      message: "Add desktop Git workflow and board interface",
      summary: "2 files · +32 / -3 across desktop, web",
    });
  });

  it("keeps an empty group explicit", () => {
    expect(suggestCommit([])).toEqual({ message: "", summary: "No files assigned to this commit." });
  });
});

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

function channels(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]).filter((channel): channel is string => channel !== undefined);
}

describe("desktop IPC contract", () => {
  it("registers a main-process handler for every preload invocation", async () => {
    const [mainSource, preloadSource] = await Promise.all([
      readFile(new URL("../src/main.cjs", import.meta.url), "utf8"),
      readFile(new URL("../src/preload.cjs", import.meta.url), "utf8"),
    ]);
    const handled = new Set(channels(mainSource, /ipcMain\.handle\("([^"]+)"/g));
    const invoked = channels(preloadSource, /ipcRenderer\.invoke\("([^"]+)"/g);

    expect(invoked).not.toHaveLength(0);
    expect(invoked.filter((channel) => !handled.has(channel))).toEqual([]);
    expect([...handled]).toEqual(expect.arrayContaining([
      "relay:git:status",
      "relay:git:diff",
      "relay:git:history",
      "relay:git:compare",
      "relay:git:compare-diff",
      "relay:git:prepare",
      "relay:git:execute",
      "relay:git:push",
    ]));
  });
});

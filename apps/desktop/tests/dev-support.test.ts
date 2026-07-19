import { describe, expect, it, vi } from "vitest";

import {
  findAvailableRendererPort,
  rendererUrl,
  rendererUrlForPort,
  shouldRestartDesktop,
  waitForRenderer,
} from "../scripts/dev-support.mjs";

describe("desktop renderer readiness", () => {
  it("waits for the Relay renderer instead of accepting another service", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("<title>Another application</title>"))
      .mockResolvedValueOnce(new Response("<title>Relay - Development that remembers</title>"));
    const pause = vi.fn(async () => undefined);

    await waitForRenderer({ attempts: 2, pause, request });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith(rendererUrl);
    expect(pause).toHaveBeenCalledOnce();
  });

  it("fails clearly when the renderer never becomes ready", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("connection refused"));

    await expect(waitForRenderer({ attempts: 1, request })).rejects.toThrow(
      `Relay renderer did not start at ${rendererUrl}`,
    );
  });

  it("waits for a renderer on the selected dev port", async () => {
    const url = rendererUrlForPort(3012);
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<title>Relay - Development that remembers</title>"));

    await waitForRenderer({ attempts: 1, request, url });

    expect(request).toHaveBeenCalledWith(url);
  });

  it("selects the first available renderer port", async () => {
    const available = vi
      .fn<(port: number) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(findAvailableRendererPort({ available, preferredPort: 3000 })).resolves.toBe(3002);
  });

  it("restarts Electron when desktop CommonJS sources change", () => {
    expect(shouldRestartDesktop("main.cjs")).toBe(true);
    expect(shouldRestartDesktop(Buffer.from("git-workflow.cjs"))).toBe(true);
    expect(shouldRestartDesktop("README.md")).toBe(false);
    expect(shouldRestartDesktop(null)).toBe(false);
  });

});

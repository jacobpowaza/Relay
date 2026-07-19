import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const semver = require("../src/semver.cjs");
const { loadAppSettings, saveAppSettings, normalizeAppSettings, appSettingsDefaults } = require("../src/app-settings.cjs");
const { createBackgroundService } = require("../src/background-service.cjs");
const { createUpdaterService } = require("../src/updater-service.cjs");
const platformService = require("../src/platform-service.cjs");

describe("semver", () => {
  it("orders major/minor/patch", () => {
    expect(semver.gt("1.2.0", "1.1.9")).toBe(true);
    expect(semver.gt("2.0.0", "1.9.9")).toBe(true);
    expect(semver.compare("1.0.0", "1.0.0")).toBe(0);
    expect(semver.gt("v1.4.0", "1.3.0")).toBe(true);
  });

  it("ranks a prerelease below its release", () => {
    expect(semver.gt("1.0.0", "1.0.0-beta.1")).toBe(true);
    expect(semver.gt("1.0.0-beta.2", "1.0.0-beta.1")).toBe(true);
    expect(semver.isPrerelease("1.0.0-beta.1")).toBe(true);
    expect(semver.isPrerelease("1.0.0")).toBe(false);
  });

  it("treats malformed versions as equal (no crash)", () => {
    expect(semver.compare("not-a-version", "1.0.0")).toBe(0);
    expect(semver.isValid("1.2.3")).toBe(true);
    expect(semver.isValid("1.2")).toBe(false);
  });
});

describe("app-settings", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "relay-settings-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); });

  it("returns defaults when no file exists", async () => {
    const settings = await loadAppSettings(dir);
    expect(settings.updates.autoCheck).toBe(true);
    expect(settings.updates.autoDownload).toBe(false);
    expect(settings.background.closeAction).toBe("quit");
  });

  it("persists a section-scoped patch and round-trips", async () => {
    await saveAppSettings(dir, { updates: { autoDownload: true, skippedVersion: "1.5.0" } });
    const reloaded = await loadAppSettings(dir);
    expect(reloaded.updates.autoDownload).toBe(true);
    expect(reloaded.updates.skippedVersion).toBe("1.5.0");
    // untouched sections keep defaults
    expect(reloaded.background.closeAction).toBe("quit");
  });

  it("normalizes unknown/invalid values", () => {
    const normalized = normalizeAppSettings({ updates: { channel: "bogus", autoCheck: "yes" }, background: { closeAction: "explode" } });
    expect(normalized.updates.channel).toBe("stable");
    expect(normalized.updates.autoCheck).toBe(appSettingsDefaults.updates.autoCheck);
    expect(normalized.background.closeAction).toBe("quit");
  });
});

describe("background-service", () => {
  function fakeApp() {
    let loginSettings = { openAtLogin: false };
    return {
      setLoginItemSettings: vi.fn((next: { openAtLogin: boolean }) => { loginSettings = { ...loginSettings, ...next }; }),
      getLoginItemSettings: () => loginSettings,
      quit: vi.fn(),
    };
  }

  it("hides on close only when keep-alive + hide are set", () => {
    const app = fakeApp();
    const bg = createBackgroundService({ app, platformService });
    bg.setSettings({ runInBackground: false, launchAtLogin: false, keepAliveOnClose: false, closeAction: "hide" });
    expect(bg.resolveCloseIntent()).toBe("quit");
    bg.setSettings({ runInBackground: true, launchAtLogin: false, keepAliveOnClose: false, closeAction: "hide" });
    expect(bg.resolveCloseIntent()).toBe("hide");
    bg.setSettings({ runInBackground: true, launchAtLogin: false, keepAliveOnClose: false, closeAction: "quit" });
    expect(bg.resolveCloseIntent()).toBe("quit");
  });

  it("applies login item through the OS API", () => {
    const app = fakeApp();
    const bg = createBackgroundService({ app, platformService });
    bg.setSettings({ runInBackground: false, launchAtLogin: true, keepAliveOnClose: false, closeAction: "quit" });
    expect(app.setLoginItemSettings).toHaveBeenCalledWith(expect.objectContaining({ openAtLogin: true }));
  });

  it("runs every teardown handler exactly once on quit and latches quitting", async () => {
    const app = fakeApp();
    const bg = createBackgroundService({ app, platformService });
    const teardown = vi.fn();
    bg.registerTeardown(teardown);
    await bg.requestQuit();
    await bg.requestQuit(); // idempotent
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(bg.isQuitting()).toBe(true);
    expect(app.quit).toHaveBeenCalledTimes(1);
  });
});

describe("updater-service", () => {
  let dir: string;
  let autoUpdater: EventEmitter & Record<string, unknown>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "relay-updater-"));
    autoUpdater = Object.assign(new EventEmitter(), {
      autoDownload: true,
      autoInstallOnAppQuit: false,
      allowDowngrade: true,
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(async () => ({})),
      downloadUpdate: vi.fn(async () => ["file"]),
      quitAndInstall: vi.fn(),
    });
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); });

  function makeService(settingsOverride: Record<string, unknown> = {}) {
    const settings = { autoCheck: true, autoDownload: false, channel: "stable", skippedVersion: null, dismissedVersion: null, lastCheckAt: null, ...settingsOverride };
    const persisted: Record<string, unknown> = {};
    const emitted: unknown[] = [];
    const service = createUpdaterService({
      autoUpdater: autoUpdater as never,
      userDataPath: dir,
      currentVersion: "1.0.0",
      isPackaged: true,
      platformService,
      loadUpdateSettings: async () => ({ ...settings, ...persisted }),
      persistUpdateSettings: async (patch: Record<string, unknown>) => { Object.assign(persisted, patch); },
      emit: (state: unknown) => emitted.push(state),
      log: () => undefined,
    });
    return { service, emitted, persisted };
  }

  it("drives the state machine through the happy path and writes a pending marker", async () => {
    const { service, emitted } = makeService();
    await service.check({ manual: true });
    autoUpdater.emit("checking-for-update");
    autoUpdater.emit("update-available", { version: "1.2.0", releaseName: "Nice", releaseDate: "2026-01-01T00:00:00Z" });
    autoUpdater.emit("download-progress", { percent: 42, transferred: 42, total: 100, bytesPerSecond: 10 });
    autoUpdater.emit("update-downloaded", { version: "1.2.0" });

    const phases = emitted.map((s) => (s as { phase: string }).phase);
    expect(phases).toContain("checking");
    expect(phases).toContain("available");
    expect(phases).toContain("downloading");
    expect(service.getState().phase).toBe("ready");

    // The pending marker is written fire-and-forget; give it a tick to land.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const marker = JSON.parse(await readFile(path.join(dir, "relay-pending-update.json"), "utf8"));
    expect(marker.version).toBe("1.2.0");
  });

  it("auto-downloads when the setting is on", async () => {
    const { service } = makeService({ autoDownload: true });
    await service.check({ manual: false });
    autoUpdater.emit("update-available", { version: "2.0.0" });
    await Promise.resolve();
    await Promise.resolve();
    expect(autoUpdater.downloadUpdate).toHaveBeenCalled();
  });

  it("surfaces errors as a failed phase", async () => {
    const { service } = makeService();
    autoUpdater.emit("error", new Error("network down"));
    expect(service.getState().phase).toBe("failed");
    expect(service.getState().error).toContain("network down");
  });

  it("refuses to install unless an update is ready", () => {
    const { service } = makeService();
    const result = service.installAndRestart();
    expect(result.installed).toBe(false);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("persists a skipped version", async () => {
    const { service, persisted } = makeService();
    await service.skipVersion("3.0.0");
    expect(persisted.skippedVersion).toBe("3.0.0");
  });

  it("flags a failed install when the app did not relaunch into the staged version", async () => {
    const { service } = makeService();
    // Stage a marker for a version newer than currentVersion (1.0.0) directly,
    // so the verification runs against a known on-disk marker.
    await writeFile(path.join(dir, "relay-pending-update.json"), JSON.stringify({ version: "9.9.9", stagedAt: new Date().toISOString() }), "utf8");
    await service.verifyPendingInstall(semver.gte);
    expect(service.getState().phase).toBe("failed");
  });
});

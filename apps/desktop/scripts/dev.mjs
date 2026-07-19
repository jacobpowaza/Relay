import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { createRequire } from "node:module";

import {
  defaultRendererPort,
  findAvailableRendererPort,
  rendererHost,
  rendererUrl,
  rendererUrlForPort,
  shouldRestartDesktop,
  waitForRenderer,
} from "./dev-support.mjs";

const projectRoot = new URL("../../../", import.meta.url);
const desktopRoot = new URL("../", import.meta.url);
const desktopSource = new URL("../src/", import.meta.url);
const electronBinary = createRequire(import.meta.url)("electron");

/**
 * @param {string} command
 * @param {string[]} args
 * @param {Record<string, string>} [environment]
 */
function start(command, args, environment = {}) {
  return spawn(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...environment },
    shell: process.platform === "win32",
    stdio: "inherit",
  });
}

let ownsRenderer = false;
let activeRendererUrl = rendererUrl;
/** @type {import("node:child_process").ChildProcess | null} */
let renderer = null;

try {
  await waitForRenderer({ attempts: 1, url: rendererUrl });
} catch {
  const rendererPort = await findAvailableRendererPort({
    preferredPort: defaultRendererPort,
  });
  activeRendererUrl = rendererUrlForPort(rendererPort);
  renderer = start(
    "pnpm",
    [
      "--filter",
      "@relay/web",
      "exec",
      "next",
      "dev",
      "--hostname",
      rendererHost,
      "--port",
      String(rendererPort),
    ],
  );
  ownsRenderer = true;
}

function stopRenderer() {
  if (ownsRenderer && renderer !== null && renderer.exitCode === null && renderer.signalCode === null) {
    renderer.kill("SIGINT");
  }
}

await waitForRenderer({ url: activeRendererUrl });

/** @type {import("node:child_process").ChildProcess | null} */
let desktop = null;
/** @type {NodeJS.Timeout | null} */
let restartTimeout = null;
let restartPending = false;
let stopping = false;
/** @type {(exitCode: number | null) => void} */
let resolveDesktopExit;
const desktopExit = new Promise((resolve) => {
  resolveDesktopExit = resolve;
});

function launchDesktop() {
  desktop = spawn(electronBinary, ["src/main.cjs"], {
    cwd: desktopRoot,
    env: { ...process.env, RELAY_DEV_SERVER_URL: activeRendererUrl },
    stdio: "inherit",
  });
  desktop.once("exit", (exitCode) => {
    desktop = null;
    if (restartPending && !stopping) {
      restartPending = false;
      launchDesktop();
      return;
    }
    resolveDesktopExit(exitCode);
  });
}

function scheduleDesktopRestart() {
  if (stopping) return;
  restartPending = true;
  if (restartTimeout !== null) clearTimeout(restartTimeout);
  restartTimeout = setTimeout(() => {
    restartTimeout = null;
    if (desktop === null) {
      restartPending = false;
      launchDesktop();
      return;
    }
    desktop.kill("SIGTERM");
  }, 100);
}

const desktopWatcher = watch(desktopSource, { recursive: true }, (_event, filename) => {
  if (shouldRestartDesktop(filename)) scheduleDesktopRestart();
});

for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.once(signal, () => {
    stopping = true;
    desktopWatcher.close();
    if (restartTimeout !== null) clearTimeout(restartTimeout);
    desktop?.kill(signal);
    stopRenderer();
  });
}

launchDesktop();
const exitCode = await desktopExit;
desktopWatcher.close();
stopRenderer();
process.exitCode = typeof exitCode === "number" ? exitCode : 1;

"use strict";

// System tray (Windows) / menu-bar (macOS) item. A single Tray instance is
// created lazily and rebuilt in place, so background mode never leaves duplicate
// icons behind. destroy() is registered with the background teardown registry so
// an explicit quit removes it cleanly.

const path = require("node:path");
const { Tray, Menu, nativeImage } = require("electron");

/**
 * @param {{
 *   platformService: typeof import("./platform-service.cjs");
 *   iconPath?: string;
 *   onOpen: () => void;
 *   onCheckForUpdates: () => void;
 *   onQuit: () => void;
 *   getStatusLabel: () => string;
 *   log?: (message: string, error?: unknown) => void;
 * }} deps
 */
function createTrayService(deps) {
  const { platformService, onOpen, onCheckForUpdates, onQuit, getStatusLabel, log = () => undefined } = deps;
  const iconPath = deps.iconPath ?? path.join(__dirname, "..", "build", "icon.png");

  /** @type {import("electron").Tray | null} */
  let tray = null;

  function buildIcon() {
    let image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      image = image.resize({ width: 18, height: 18 });
      // macOS renders template images correctly in both light/dark menu bars.
      if (platformService.isMac) image.setTemplateImage(true);
    }
    return image;
  }

  function buildMenu() {
    return Menu.buildFromTemplate([
      { label: "Open Relay", click: () => onOpen() },
      { type: "separator" },
      { label: getStatusLabel(), enabled: false },
      { type: "separator" },
      { label: "Check for Updates…", click: () => onCheckForUpdates() },
      { type: "separator" },
      { label: "Quit Relay", click: () => onQuit() },
    ]);
  }

  function ensure() {
    if (tray !== null) return tray;
    try {
      tray = new Tray(buildIcon());
      tray.setToolTip("Relay");
      // Left-click opens the window on Windows/Linux; macOS shows the menu.
      tray.on("click", () => {
        if (platformService.isMac) return;
        onOpen();
      });
      refresh();
    } catch (error) {
      log("Could not create tray icon", error);
      tray = null;
    }
    return tray;
  }

  function refresh() {
    if (tray === null) return;
    try {
      tray.setContextMenu(buildMenu());
    } catch (error) {
      log("Could not refresh tray menu", error);
    }
  }

  function destroy() {
    if (tray === null) return;
    try {
      tray.destroy();
    } catch (error) {
      log("Could not destroy tray", error);
    }
    tray = null;
  }

  function exists() {
    return tray !== null;
  }

  return { destroy, ensure, exists, refresh };
}

module.exports = { createTrayService };

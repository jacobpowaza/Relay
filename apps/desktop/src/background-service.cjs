"use strict";

// Owns Relay's background/quit lifecycle policy so main.cjs never has to reason
// about platform-specific window semantics inline. Holds the current background
// settings and a teardown registry; a "real quit" runs every registered cleanup
// (watchers, timers, child processes, tray) before the app exits and latches a
// flag so nothing re-opens a window afterwards.

/**
 * @param {{
 *   app: import("electron").App;
 *   platformService: typeof import("./platform-service.cjs");
 *   log?: (message: string, error?: unknown) => void;
 * }} deps
 */
function createBackgroundService(deps) {
  const { app, platformService, log = () => undefined } = deps;

  /** @type {import("./app-settings.cjs").RelayBackgroundSettings} */
  let settings = { runInBackground: false, launchAtLogin: false, keepAliveOnClose: false, closeAction: "quit" };
  let quitting = false;
  /** @type {Set<() => void | Promise<void>>} */
  const teardownHandlers = new Set();

  /** @param {() => void | Promise<void>} handler @returns {() => void} unregister */
  function registerTeardown(handler) {
    teardownHandlers.add(handler);
    return () => teardownHandlers.delete(handler);
  }

  /** @param {import("./app-settings.cjs").RelayBackgroundSettings} next */
  function setSettings(next) {
    settings = next;
    applyLoginItem();
  }

  function getSettings() {
    return settings;
  }

  // Login-at-startup: Electron's setLoginItemSettings covers macOS login items
  // and the Windows startup registry. It is unsupported on Linux, so we skip it
  // there rather than assume a specific desktop's autostart mechanism.
  function applyLoginItem() {
    if (!platformService.isMac && !platformService.isWindows) return;
    try {
      /** @type {import("electron").Settings} */
      const loginSettings = { openAtLogin: settings.launchAtLogin };
      // openAsHidden is macOS-only; only set it there to avoid an undefined value.
      if (platformService.isMac) loginSettings.openAsHidden = settings.launchAtLogin && settings.runInBackground;
      app.setLoginItemSettings(loginSettings);
    } catch (error) {
      log("Could not update login-item settings", error);
    }
  }

  /** @returns {boolean} whether the setting the OS actually has matches ours */
  function loginItemEnabled() {
    if (!platformService.isMac && !platformService.isWindows) return false;
    try {
      return app.getLoginItemSettings().openAtLogin === true;
    } catch {
      return settings.launchAtLogin;
    }
  }

  /**
   * Decides what a window "close" gesture should do. When background mode keeps
   * Relay alive and the close action is "hide", we keep the process resident;
   * otherwise a close is a real quit.
   * @returns {"hide" | "quit"}
   */
  function resolveCloseIntent() {
    const keepAlive = settings.runInBackground || settings.keepAliveOnClose;
    if (keepAlive && settings.closeAction === "hide") return "hide";
    return "quit";
  }

  function isQuitting() {
    return quitting;
  }

  /**
   * Whether the app should stay running after all windows close. On macOS the
   * platform convention is to stay resident; we honor that only when background
   * mode is on, so a user who wants a clean quit gets one.
   */
  function shouldStayResidentWithNoWindows() {
    if (quitting) return false;
    return settings.runInBackground || settings.keepAliveOnClose;
  }

  /**
   * Latches the quitting flag and runs every registered teardown handler
   * (watchers, timers, tray, child processes). Idempotent, so it is safe to call
   * from the tray, a menu item, and the app "before-quit" event without doubling
   * up. Does NOT call app.quit() itself.
   */
  async function beginQuit() {
    if (quitting) return;
    quitting = true;
    for (const handler of teardownHandlers) {
      try {
        await handler();
      } catch (error) {
        log("Teardown handler failed during quit", error);
      }
    }
    teardownHandlers.clear();
  }

  /**
   * Executes a real quit: tear everything down, then exit. Used by the tray and
   * menu "Quit Relay" actions.
   */
  async function requestQuit() {
    const alreadyQuitting = quitting;
    await beginQuit();
    if (!alreadyQuitting) app.quit();
  }

  function getStatus() {
    return {
      runInBackground: settings.runInBackground,
      keepAliveOnClose: settings.keepAliveOnClose,
      closeAction: settings.closeAction,
      launchAtLogin: loginItemEnabled(),
      resident: shouldStayResidentWithNoWindows(),
    };
  }

  return {
    applyLoginItem,
    beginQuit,
    getSettings,
    getStatus,
    isQuitting,
    loginItemEnabled,
    registerTeardown,
    requestQuit,
    resolveCloseIntent,
    setSettings,
    shouldStayResidentWithNoWindows,
  };
}

module.exports = { createBackgroundService };

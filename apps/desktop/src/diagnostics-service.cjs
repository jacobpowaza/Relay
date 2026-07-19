"use strict";

// Development-only runtime diagnostics. Other modules register gauges (counts
// they own) and record events (git refreshes, update checks); this service turns
// those plus process CPU/memory into a snapshot. It holds no timers of its own —
// it is strictly pull-based, so it never contributes to idle CPU.

/**
 * @param {{ enabled: boolean }} deps
 */
function createDiagnosticsService(deps) {
  const enabled = deps.enabled === true;
  /** @type {Map<string, () => number>} */
  const gauges = new Map();
  /** @type {Map<string, number[]>} */
  const eventTimes = new Map();
  const startedAt = Date.now();

  /** @param {string} name @param {() => number} read */
  function registerGauge(name, read) {
    if (!enabled) return () => undefined;
    gauges.set(name, read);
    return () => gauges.delete(name);
  }

  /** @param {string} name */
  function recordEvent(name) {
    if (!enabled) return;
    const now = Date.now();
    const cutoff = now - 60_000;
    const times = (eventTimes.get(name) ?? []).filter((t) => t >= cutoff);
    times.push(now);
    eventTimes.set(name, times);
  }

  /** @param {string} name @returns {number} events in the last 60s */
  function ratePerMinute(name) {
    const cutoff = Date.now() - 60_000;
    return (eventTimes.get(name) ?? []).filter((t) => t >= cutoff).length;
  }

  /** @param {string} name @returns {number} */
  function gaugeValue(name) {
    const read = gauges.get(name);
    if (read === undefined) return 0;
    try {
      return read();
    } catch {
      return 0;
    }
  }

  /** @returns {object | null} */
  function snapshot() {
    if (!enabled) return null;
    const cpu = process.getCPUUsage();
    const memory = process.memoryUsage();
    return {
      enabled: true,
      capturedAt: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      main: {
        cpuPercent: Math.round((cpu.percentCPUUsage ?? 0) * 100) / 100,
        memoryMB: Math.round((memory.rss / (1024 * 1024)) * 10) / 10,
        heapUsedMB: Math.round((memory.heapUsed / (1024 * 1024)) * 10) / 10,
      },
      activeTimers: gaugeValue("timers"),
      activeWatchers: gaugeValue("watchers"),
      childProcesses: gaugeValue("childProcesses"),
      windows: gaugeValue("windows"),
      gitRefreshesPerMinute: ratePerMinute("gitRefresh"),
      updateChecksPerMinute: ratePerMinute("updateCheck"),
    };
  }

  return { enabled, registerGauge, recordEvent, snapshot };
}

module.exports = { createDiagnosticsService };

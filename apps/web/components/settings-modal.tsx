"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Gauge,
  Plug,
  Power,
  RefreshCw,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

import {
  getAppSettings,
  getDiagnostics,
  getIntegrationConfig,
  isDesktopRuntime,
  setAppSettings,
  setIntegrationConfig,
} from "../lib/storage";
import { useRelayUpdates } from "./update-center";
import { useDocumentVisible, useEscapeKey, useFocusTrap } from "./ui-primitives";

import type {
  RelayAppSettings,
  RelayBackgroundStatus,
  RelayDiagnosticsSnapshot,
  RelayIntegrationConfig,
} from "../lib/desktop";
import type { RelaySettings, RelayView } from "../lib/types";

type SettingsTab = "general" | "appearance" | "updates" | "background" | "plugin" | "data";

const tabs: Array<{ id: SettingsTab; label: string; icon: typeof UserRound }> = [
  { id: "general", label: "General", icon: UserRound },
  { id: "appearance", label: "Appearance", icon: SlidersHorizontal },
  { id: "updates", label: "Updates", icon: Download },
  { id: "background", label: "Background", icon: Power },
  { id: "plugin", label: "Relay Plugin", icon: Plug },
  { id: "data", label: "Data & Storage", icon: Database },
];

function formatTimestamp(value: string | null): string {
  if (value === null) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString();
}

function updatePhaseLabel(phase: string): string {
  switch (phase) {
    case "checking": return "Checking…";
    case "available": return "Update Available";
    case "downloading": return "Downloading…";
    case "ready": return "Ready to Install";
    case "failed": return "Update Failed";
    case "current": return "Up to Date";
    default: return "Idle";
  }
}

function navigatorIsMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(navigator.platform) || /mac/i.test(navigator.userAgent);
}

type PluginLoadState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; message: string }
  | { status: "ready"; config: RelayIntegrationConfig; configPath: string; saving: boolean; saveError: string | null; savedAt: number | null };

export function SettingsModal({
  settings,
  storagePath,
  viewOptions,
  onOpenStorage,
  onSettingsChange,
  onClose,
}: {
  settings: RelaySettings;
  storagePath: string | null;
  viewOptions: Array<{ id: RelayView; label: string }>;
  onOpenStorage: () => void;
  onSettingsChange: (update: Partial<RelaySettings>) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [tab, setTab] = useState<SettingsTab>("general");
  const [plugin, setPlugin] = useState<PluginLoadState>({ status: "loading" });
  const [appSettings, setAppSettingsState] = useState<RelayAppSettings | null>(null);
  const [backgroundStatus, setBackgroundStatus] = useState<RelayBackgroundStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<RelayDiagnosticsSnapshot | null>(null);
  const updates = useRelayUpdates();
  const containerRef = useFocusTrap();
  useEscapeKey(onClose);

  const desktop = isDesktopRuntime();
  const documentVisible = useDocumentVisible();

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void getAppSettings().then((result) => {
      if (!active || result === null) return;
      setAppSettingsState(result.settings);
      setBackgroundStatus(result.backgroundStatus);
    });
    return () => { active = false; };
  }, [desktop]);

  // Diagnostics are dev-only; poll on-demand while the Background tab is open,
  // never in the background — keeping the idle-CPU guarantee intact. Also
  // suspended while the document is hidden: the tab being open is not a reason
  // to keep a 2s timer alive behind a minimized window on battery.
  useEffect(() => {
    if (!desktop || tab !== "background" || !documentVisible) return;
    let active = true;
    const load = () => { void getDiagnostics().then((snapshot) => { if (active) setDiagnostics(snapshot); }); };
    load();
    const interval = window.setInterval(load, 2000);
    return () => { active = false; window.clearInterval(interval); };
  }, [desktop, tab, documentVisible]);

  const patchUpdateSettings = useCallback(async (patch: Partial<RelayAppSettings["updates"]>) => {
    setAppSettingsState((current) => (current === null ? current : { ...current, updates: { ...current.updates, ...patch } }));
    const result = await setAppSettings({ updates: patch });
    if (result !== null) { setAppSettingsState(result.settings); setBackgroundStatus(result.backgroundStatus); }
  }, []);

  const patchBackgroundSettings = useCallback(async (patch: Partial<RelayAppSettings["background"]>) => {
    setAppSettingsState((current) => (current === null ? current : { ...current, background: { ...current.background, ...patch } }));
    const result = await setAppSettings({ background: patch });
    if (result !== null) { setAppSettingsState(result.settings); setBackgroundStatus(result.backgroundStatus); }
  }, []);

  const loadPluginConfig = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setPlugin({ status: "unavailable" });
      return;
    }
    try {
      const result = await getIntegrationConfig();
      if (result === null) {
        setPlugin({ status: "unavailable" });
        return;
      }
      setPlugin({ status: "ready", config: result.config, configPath: result.configPath, saving: false, saveError: null, savedAt: null });
    } catch (error: unknown) {
      setPlugin({ status: "error", message: error instanceof Error ? error.message : "Could not read the plugin settings file." });
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadPluginConfig();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadPluginConfig]);

  async function savePluginConfig(update: Partial<RelayIntegrationConfig>) {
    setPlugin((current) => {
      if (current.status !== "ready" || current.saving) return current;
      return { ...current, config: { ...current.config, ...update, repositories: update.repositories ?? current.config.repositories }, saving: true, saveError: null };
    });
    try {
      const result = await setIntegrationConfig(update);
      if (result === null) throw new Error("The Relay desktop bridge is unavailable.");
      setPlugin((current) => current.status === "ready"
        ? { status: "ready", config: result.config, configPath: result.configPath, saving: false, saveError: null, savedAt: Date.now() }
        : current);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "The plugin settings could not be saved.";
      setPlugin((current) => current.status === "ready" ? { ...current, saving: false, saveError: message } : current);
      void loadPluginConfig();
    }
  }

  function pluginStatusChip(config: RelayIntegrationConfig): { label: string; tone: string } {
    if (!config.enabled) return { label: "Disabled", tone: "off" };
    const linked = Object.values(config.repositories).filter((link) => link.enabled).length;
    if (linked === 0) return { label: "Enabled - No Linked Projects", tone: "idle" };
    return { label: `Active - ${linked} Linked ${linked === 1 ? "Project" : "Projects"}`, tone: "on" };
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={(node) => { containerRef.current = node; }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header settings-header">
          <div>
            <span className="eyebrow">Settings</span>
            <h2 id={titleId}>Workspace Settings</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-tabs" aria-label="Settings sections" role="tablist">
            {tabs.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  className={tab === item.id ? "active" : undefined}
                  onClick={() => setTab(item.id)}
                >
                  <Icon size={15} /> {item.label}
                </button>
              );
            })}
          </nav>
          <div className="settings-panels" role="tabpanel">
            {tab === "general" && (
              <div className="settings-panel">
                <section className="settings-section">
                  <h3>Profile</h3>
                  <p className="settings-section-hint">How your changes are attributed in board activity.</p>
                  <label>
                    <span>Display Name</span>
                    <input value={settings.displayName} onChange={(event) => onSettingsChange({ displayName: event.target.value })} maxLength={80} />
                  </label>
                </section>
                <section className="settings-section">
                  <h3>Boards</h3>
                  <p className="settings-section-hint">What opens first when you enter a board.</p>
                  <label>
                    <span>Default Board View</span>
                    <select value={settings.defaultView} onChange={(event) => onSettingsChange({ defaultView: event.target.value as RelayView })}>
                      {viewOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Recent Activity Limit</span>
                    <input type="number" min="0" max="20" value={settings.activityLimit} onChange={(event) => onSettingsChange({ activityLimit: Number(event.target.value) })} />
                    <small>How many recent entries the dashboard shows.</small>
                  </label>
                </section>
              </div>
            )}

            {tab === "appearance" && (
              <div className="settings-panel">
                <section className="settings-section">
                  <h3>Theme</h3>
                  <p className="settings-section-hint">Choose light, dark, or match your system.</p>
                  <label>
                    <span>Theme</span>
                    <select value={settings.appearance} onChange={(event) => onSettingsChange({ appearance: event.target.value as RelaySettings["appearance"] })}>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                      <option value="system">System</option>
                    </select>
                  </label>
                </section>
                <section className="settings-section">
                  <h3>Layout</h3>
                  <p className="settings-section-hint">Density and sizing for the kanban board.</p>
                  <label>
                    <span>Density</span>
                    <select value={settings.density} onChange={(event) => onSettingsChange({ density: event.target.value as RelaySettings["density"] })}>
                      <option value="comfortable">Comfortable</option>
                      <option value="compact">Compact</option>
                    </select>
                  </label>
                  <label>
                    <span>Column Width</span>
                    <input type="number" min="200" max="280" value={settings.boardColumnWidth} onChange={(event) => onSettingsChange({ boardColumnWidth: Number(event.target.value) })} />
                    <small>Pixels per board holder, between 200 and 280.</small>
                  </label>
                  <label className="settings-check">
                    <input type="checkbox" checked={settings.compactCards} onChange={(event) => onSettingsChange({ compactCards: event.target.checked })} />
                    <span>Compact Cards</span>
                  </label>
                </section>
                <section className="settings-section">
                  <h3>Motion</h3>
                  <p className="settings-section-hint">Reduce animation and rendering work.</p>
                  <label className="settings-check">
                    <input type="checkbox" checked={settings.performanceMode} onChange={(event) => onSettingsChange({ performanceMode: event.target.checked })} />
                    <span>Performance Mode</span>
                  </label>
                  <label className="settings-check">
                    <input type="checkbox" checked={settings.reduceMotion} onChange={(event) => onSettingsChange({ reduceMotion: event.target.checked })} />
                    <span>Reduce Motion</span>
                  </label>
                </section>
              </div>
            )}

            {tab === "updates" && (
              <div className="settings-panel">
                {!desktop && (
                  <section className="settings-section">
                    <h3>Updates</h3>
                    <p className="settings-section-hint">Automatic updates are managed by the Relay desktop app. Open Relay as a desktop app to check for and install updates.</p>
                  </section>
                )}
                {desktop && (
                  <>
                    <section className="settings-section">
                      <div className="settings-section-title-row">
                        <h3>Software Updates</h3>
                        {updates.state !== null && <span className={`update-status-chip ${updates.state.phase}`}>{updatePhaseLabel(updates.state.phase)}</span>}
                      </div>
                      <p className="settings-section-hint">Relay updates from signed GitHub Releases for {updates.state?.target.label ?? "this platform"}.</p>
                      <div className="settings-readout"><span>Installed Version</span><strong>{updates.state?.currentVersion ?? "—"}</strong></div>
                      <div className="settings-readout"><span>Last Checked</span><strong>{formatTimestamp(updates.state?.lastCheckAt ?? null)}</strong></div>
                      {updates.state?.phase === "available" && updates.state.availableVersion !== null && (
                        <div className="settings-readout"><span>Available</span><strong>{updates.state.availableVersion}</strong></div>
                      )}
                      {updates.state?.note !== null && updates.state?.note !== undefined && (
                        <p className="settings-section-hint">{updates.state.note}</p>
                      )}
                      {updates.state?.phase === "failed" && updates.state.error !== null && (
                        <p className="settings-error" role="alert"><AlertTriangle size={13} /> {updates.state.error}</p>
                      )}
                      {updates.state?.phase === "ready" && (
                        <p className="settings-saved"><CheckCircle2 size={13} /> Update {updates.state.availableVersion} verified and ready to install.</p>
                      )}
                      <div className="settings-inline-actions">
                        <button className="secondary-button" type="button" disabled={updates.busy || updates.state?.phase === "checking" || updates.state?.phase === "downloading"} onClick={() => { void updates.check(true); }}>
                          <RefreshCw size={14} className={updates.state?.phase === "checking" ? "spin" : undefined} /> Check for Updates
                        </button>
                        {updates.state?.phase === "available" && (
                          <button className="secondary-button" type="button" disabled={updates.busy} onClick={() => { void updates.download(); }}>
                            <Download size={14} /> Download
                          </button>
                        )}
                        {updates.state?.phase === "ready" && (
                          <button className="primary-button compact" type="button" onClick={() => { void updates.install(); }}>Install & Restart</button>
                        )}
                        {updates.state?.releaseUrl !== null && updates.state?.releaseUrl !== undefined && (
                          <a className="secondary-button" href={updates.state.releaseUrl} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} /> View Release</a>
                        )}
                      </div>
                    </section>
                    <section className="settings-section">
                      <h3>Automatic Updates</h3>
                      <label className="settings-check">
                        <input type="checkbox" checked={appSettings?.updates.autoCheck ?? true} onChange={(event) => { void patchUpdateSettings({ autoCheck: event.target.checked }); }} />
                        <span>Automatically check for updates</span>
                      </label>
                      <label className="settings-check">
                        <input type="checkbox" checked={appSettings?.updates.autoDownload ?? false} onChange={(event) => { void patchUpdateSettings({ autoDownload: event.target.checked }); }} />
                        <span>Automatically download updates in the background</span>
                      </label>
                      <label>
                        <span>Update Channel</span>
                        <select value={appSettings?.updates.channel ?? "stable"} onChange={(event) => { void patchUpdateSettings({ channel: event.target.value as RelayAppSettings["updates"]["channel"] }); }}>
                          <option value="stable">Stable</option>
                          <option value="prerelease">Prerelease (early access)</option>
                        </select>
                        <small>Prereleases include drafts and beta builds. Stable ignores them.</small>
                      </label>
                      {appSettings?.updates.skippedVersion != null && (
                        <div className="linked-repo-row">
                          <div className="linked-repo-copy"><strong>Skipped {appSettings.updates.skippedVersion}</strong><small>You won&apos;t be prompted for this version.</small></div>
                          <button className="secondary-button compact" type="button" onClick={() => { void patchUpdateSettings({ skippedVersion: null }); }}>Un-skip</button>
                        </div>
                      )}
                    </section>
                  </>
                )}
              </div>
            )}

            {tab === "background" && (
              <div className="settings-panel">
                {!desktop && (
                  <section className="settings-section">
                    <h3>Background</h3>
                    <p className="settings-section-hint">Background and startup behavior is managed by the Relay desktop app.</p>
                  </section>
                )}
                {desktop && (
                  <>
                    <section className="settings-section">
                      <h3>Background &amp; Startup</h3>
                      <p className="settings-section-hint">Keep Relay ready in the {navigatorIsMac() ? "menu bar" : "system tray"} and launch it with your computer.</p>
                      <label className="settings-check">
                        <input type="checkbox" checked={appSettings?.background.runInBackground ?? false} onChange={(event) => { void patchBackgroundSettings({ runInBackground: event.target.checked }); }} />
                        <span>Run Relay in the background</span>
                      </label>
                      <label className="settings-check">
                        <input type="checkbox" checked={appSettings?.background.launchAtLogin ?? false} onChange={(event) => { void patchBackgroundSettings({ launchAtLogin: event.target.checked }); }} />
                        <span><Bell size={13} /> Launch Relay at login</span>
                      </label>
                      <label className="settings-check">
                        <input type="checkbox" checked={appSettings?.background.keepAliveOnClose ?? false} onChange={(event) => { void patchBackgroundSettings({ keepAliveOnClose: event.target.checked }); }} />
                        <span>Keep Relay active when the window is closed</span>
                      </label>
                      <label>
                        <span>When I close the window</span>
                        <select value={appSettings?.background.closeAction ?? "quit"} onChange={(event) => { void patchBackgroundSettings({ closeAction: event.target.value as RelayAppSettings["background"]["closeAction"] }); }}>
                          <option value="quit">Quit Relay completely</option>
                          <option value="hide">Hide Relay (stay in {navigatorIsMac() ? "menu bar" : "tray"})</option>
                        </select>
                        <small>Choosing “hide” requires background mode or keep-active to stay resident.</small>
                      </label>
                    </section>
                    {backgroundStatus !== null && (
                      <section className="settings-section">
                        <h3>Status</h3>
                        <div className="settings-readout"><span>Launch at Login</span><strong>{backgroundStatus.launchAtLogin ? "Enabled" : "Disabled"}</strong></div>
                        <div className="settings-readout"><span>Resident in Background</span><strong>{backgroundStatus.resident ? "Yes" : "No"}</strong></div>
                      </section>
                    )}
                    {diagnostics !== null && (
                      <section className="settings-section">
                        <div className="settings-section-title-row">
                          <h3>Diagnostics</h3>
                          <span className="plugin-status-chip idle">Developer</span>
                        </div>
                        <p className="settings-section-hint">Live main-process metrics (development builds only).</p>
                        <div className="diagnostics-grid">
                          <div className="diagnostics-cell"><Gauge size={13} /><span>Main CPU</span><strong>{diagnostics.main.cpuPercent}%</strong></div>
                          <div className="diagnostics-cell"><Activity size={13} /><span>Memory (RSS)</span><strong>{diagnostics.main.memoryMB} MB</strong></div>
                          <div className="diagnostics-cell"><span>Active Timers</span><strong>{diagnostics.activeTimers}</strong></div>
                          <div className="diagnostics-cell"><span>FS Watchers</span><strong>{diagnostics.activeWatchers}</strong></div>
                          <div className="diagnostics-cell"><span>Child Processes</span><strong>{diagnostics.childProcesses}</strong></div>
                          <div className="diagnostics-cell"><span>Windows</span><strong>{diagnostics.windows}</strong></div>
                          <div className="diagnostics-cell"><span>Git / min</span><strong>{diagnostics.gitRefreshesPerMinute}</strong></div>
                          <div className="diagnostics-cell"><span>Update checks / min</span><strong>{diagnostics.updateChecksPerMinute}</strong></div>
                        </div>
                      </section>
                    )}
                  </>
                )}
              </div>
            )}

            {tab === "plugin" && (
              <div className="settings-panel">
                {plugin.status === "loading" && <p className="settings-loading">Loading plugin settings...</p>}
                {plugin.status === "unavailable" && (
                  <section className="settings-section">
                    <h3>Relay Plugin</h3>
                    <p className="settings-section-hint">
                      Plugin settings are managed by the Relay desktop app. Open Relay as a desktop app to change how the Claude Code and Codex integrations behave.
                    </p>
                  </section>
                )}
                {plugin.status === "error" && (
                  <section className="settings-section">
                    <h3>Relay Plugin</h3>
                    <p className="settings-error" role="alert">{plugin.message}</p>
                    <button className="secondary-button" type="button" onClick={() => { void loadPluginConfig(); }}>Try Again</button>
                  </section>
                )}
                {plugin.status === "ready" && (
                  <>
                    <section className="settings-section">
                      <div className="settings-section-title-row">
                        <h3>Relay Plugin</h3>
                        <span className={`plugin-status-chip ${pluginStatusChip(plugin.config).tone}`}>{pluginStatusChip(plugin.config).label}</span>
                      </div>
                      <p className="settings-section-hint">
                        Controls the Claude Code and Codex integrations. When disabled, Relay context is not injected into agent sessions and agents stop writing to boards.
                      </p>
                      <label className="settings-check">
                        <input
                          type="checkbox"
                          checked={plugin.config.enabled}
                          disabled={plugin.saving}
                          onChange={(event) => { void savePluginConfig({ enabled: event.target.checked }); }}
                        />
                        <span>Enable Relay Plugin</span>
                      </label>
                    </section>
                    <section className="settings-section">
                      <h3>Agent Behavior</h3>
                      <label>
                        <span>Automatic Board Creation</span>
                        <select
                          value={plugin.config.automaticBoardCreation}
                          disabled={plugin.saving || !plugin.config.enabled}
                          onChange={(event) => { void savePluginConfig({ automaticBoardCreation: event.target.value as RelayIntegrationConfig["automaticBoardCreation"] }); }}
                        >
                          <option value="ask">Ask Before Creating</option>
                          <option value="on">Create Automatically</option>
                          <option value="off">Never Create</option>
                        </select>
                        <small>What agents do when a complex task starts in an unlinked project.</small>
                      </label>
                      <label>
                        <span>Update Frequency</span>
                        <select
                          value={plugin.config.checkpointFrequency}
                          disabled={plugin.saving || !plugin.config.enabled}
                          onChange={(event) => { void savePluginConfig({ checkpointFrequency: event.target.value as RelayIntegrationConfig["checkpointFrequency"] }); }}
                        >
                          <option value="meaningful_steps">After Meaningful Steps</option>
                          <option value="manual">Manual Only</option>
                        </select>
                        <small>How often agents checkpoint progress to the board.</small>
                      </label>
                    </section>
                    <section className="settings-section">
                      <h3>Linked Projects</h3>
                      <p className="settings-section-hint">Project directories connected to Relay boards. Agents in these directories resume from the linked board.</p>
                      {Object.keys(plugin.config.repositories).length === 0 && (
                        <p className="settings-empty">No projects are linked yet. Boards created from a chosen directory link automatically, and agents can link projects when they connect a board.</p>
                      )}
                      {Object.entries(plugin.config.repositories).map(([root, link]) => (
                        <div className="linked-repo-row" key={root}>
                          <div className="linked-repo-copy">
                            <strong title={root}>{root}</strong>
                            <small>Board {link.boardId.slice(0, 8)} · {link.enabled ? "Syncing" : "Paused"}</small>
                          </div>
                          <div className="linked-repo-actions">
                            <button
                              className="secondary-button compact"
                              type="button"
                              disabled={plugin.saving}
                              onClick={() => {
                                void savePluginConfig({ repositories: { ...plugin.config.repositories, [root]: { ...link, enabled: !link.enabled } } });
                              }}
                            >
                              {link.enabled ? "Pause" : "Resume"}
                            </button>
                            <button
                              className="secondary-button compact danger-text"
                              type="button"
                              disabled={plugin.saving}
                              onClick={() => {
                                const next = { ...plugin.config.repositories };
                                delete next[root];
                                void savePluginConfig({ repositories: next });
                              }}
                            >
                              Unlink
                            </button>
                          </div>
                        </div>
                      ))}
                    </section>
                    <section className="settings-section">
                      <h3>Plugin Files</h3>
                      <div className="settings-readout"><span>Settings File</span><code title={plugin.configPath}>{plugin.configPath}</code></div>
                      {plugin.saveError !== null && <p className="settings-error" role="alert">{plugin.saveError}</p>}
                      {plugin.saveError === null && plugin.savedAt !== null && (
                        <p className="settings-saved"><Check size={13} /> Plugin settings saved.</p>
                      )}
                    </section>
                  </>
                )}
              </div>
            )}

            {tab === "data" && (
              <div className="settings-panel">
                <section className="settings-section">
                  <h3>Local Data</h3>
                  <p className="settings-section-hint">Everything Relay stores lives in one file on this device. Nothing is uploaded, and board data saves automatically after every change.</p>
                  <div className="settings-readout"><span>Storage Mode</span><strong>App-Owned Local Data</strong></div>
                  <div className="settings-readout"><span>Storage File</span><code>{storagePath ?? "Resolving local storage..."}</code></div>
                  <label className="settings-check">
                    <input type="checkbox" checked={settings.showStoragePath} onChange={(event) => onSettingsChange({ showStoragePath: event.target.checked })} />
                    <span>Show Storage Path on Dashboard</span>
                  </label>
                  <button className="secondary-button storage-open-button" type="button" onClick={onOpenStorage} disabled={storagePath === null}>
                    <ExternalLink size={14} /> Open Storage File
                  </button>
                </section>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

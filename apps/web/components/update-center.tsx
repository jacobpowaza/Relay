"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  RotateCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  checkForUpdates,
  dismissUpdateVersion,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  isDesktopRuntime,
  skipUpdateVersion,
  subscribeUpdateState,
} from "../lib/storage";
import { useEscapeKey, useFocusTrap } from "./ui-primitives";

import type { RelayUpdateState } from "../lib/desktop";

/** Shared updates hook: mirrors main-process update state and exposes actions. */
export function useRelayUpdates() {
  const [state, setState] = useState<RelayUpdateState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let active = true;
    void getUpdateState().then((initial) => { if (active && initial !== null) setState(initial); });
    const unsubscribe = subscribeUpdateState((next) => setState(next));
    return () => { active = false; unsubscribe(); };
  }, []);

  const check = useCallback(async (manual: boolean) => {
    setBusy(true);
    try {
      const next = await checkForUpdates({ manual });
      if (next !== null) setState(next);
    } finally {
      setBusy(false);
    }
  }, []);

  const download = useCallback(async () => {
    setBusy(true);
    try {
      const next = await downloadUpdate();
      if (next !== null) setState(next);
    } finally {
      setBusy(false);
    }
  }, []);

  const install = useCallback(async () => { await installUpdate(); }, []);

  const skip = useCallback(async (version: string) => {
    const next = await skipUpdateVersion(version);
    if (next !== null) setState(next);
  }, []);

  const dismiss = useCallback(async (version: string) => {
    const next = await dismissUpdateVersion(version);
    if (next !== null) setState(next);
  }, []);

  return { state, busy, check, download, install, skip, dismiss };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Polished, theme-aware update popup shown when a newer stable (or opted-in
 * prerelease) version is available. Hidden while the user is on the current
 * version, has skipped this version, or has chosen "Remind me later" this
 * session.
 */
export function UpdatePopup() {
  const { state, busy, download, install, skip, dismiss } = useRelayUpdates();
  // The version the user dismissed with "remind me later" this session. Scoping
  // it to the version means a newer version re-opens the popup automatically,
  // without a reset effect.
  const [remindedVersion, setRemindedVersion] = useState<string | null>(null);
  const containerRef = useFocusTrap();

  const version = state?.availableVersion ?? null;
  const phase = state?.phase;
  const remindLater = () => setRemindedVersion(version);

  // Show for a known available version through the whole download lifecycle.
  // A failure with no resolved version (e.g. a background check that never got
  // that far) has version === null and stays silent.
  const shouldShow = (() => {
    if (state === null || version === null) return false;
    if (state.skippedVersion === version) return false;
    if (remindedVersion === version) return false;
    return phase === "available" || phase === "downloading" || phase === "ready" || phase === "failed";
  })();

  useEscapeKey(() => { if (shouldShow) remindLater(); });

  if (!shouldShow || state === null || version === null) return null;

  const progressPercent = Math.max(0, Math.min(100, Math.round(state.progress?.percent ?? 0)));

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal update-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-popup-title"
        ref={(node) => { containerRef.current = node; }}
      >
        <div className="modal-header update-popup-header">
          <div>
            <span className="eyebrow">Software Update</span>
            <h2 id="update-popup-title">Relay {version} is available</h2>
            <p className="update-popup-sub">
              You are on {state.currentVersion} · {state.target.label}
              {state.releaseDate ? ` · ${new Date(state.releaseDate).toLocaleDateString()}` : ""}
            </p>
          </div>
          <button className="icon-button" type="button" onClick={() => remindLater()} aria-label="Remind me later">
            <X size={18} />
          </button>
        </div>

        <div className="update-popup-body">
          {state.releaseNotes !== null && state.releaseNotes.trim() !== "" ? (
            <div className="update-release-notes" aria-label="Release notes">
              {state.releaseNotes.split("\n").map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </div>
          ) : (
            <p className="update-release-notes-empty">Release notes are available on GitHub.</p>
          )}

          {phase === "downloading" && (
            <div className="update-progress" role="status">
              <div className="update-progress-track"><div className="update-progress-fill" style={{ width: `${progressPercent}%` }} /></div>
              <div className="update-progress-meta">
                <span>{progressPercent}%</span>
                {state.progress !== null && (
                  <span>{formatBytes(state.progress.transferred)} / {formatBytes(state.progress.total)} · {formatBytes(state.progress.bytesPerSecond)}/s</span>
                )}
              </div>
            </div>
          )}

          {phase === "ready" && (
            <p className="update-ready" role="status"><CheckCircle2 size={15} /> Verified and ready to install. Relay will restart to finish.</p>
          )}

          {phase === "failed" && state.error !== null && (
            <p className="update-error" role="alert"><AlertTriangle size={15} /> {state.error}</p>
          )}
        </div>

        <div className="update-popup-actions">
          <div className="update-popup-actions-secondary">
            {state.releaseUrl !== null && (
              <a className="secondary-button" href={state.releaseUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink size={14} /> View Release
              </a>
            )}
            <button className="secondary-button" type="button" onClick={() => remindLater()}>Remind Me Later</button>
            <button
              className="secondary-button danger-text"
              type="button"
              onClick={() => { void dismiss(version); void skip(version); }}
            >
              Skip This Version
            </button>
          </div>
          <div className="update-popup-actions-primary">
            {phase === "available" && (
              <button className="primary-button" type="button" disabled={busy} onClick={() => { void download(); }}>
                <Download size={15} /> Download Update
              </button>
            )}
            {phase === "downloading" && (
              <button className="primary-button" type="button" disabled>
                <RefreshCw size={15} className="spin" /> Downloading…
              </button>
            )}
            {phase === "ready" && (
              <button className="primary-button" type="button" onClick={() => { void install(); }}>
                <RotateCw size={15} /> Install & Restart
              </button>
            )}
            {phase === "failed" && (
              <button className="primary-button" type="button" disabled={busy} onClick={() => { void download(); }}>
                <RefreshCw size={15} /> Try Again
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

"use client";

import { AlertTriangle, Clock3, Code2, FileText, RefreshCw, Search, Sparkles, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  cancelDiscoveryEnrichment,
  enrichDiscovery,
  estimateDiscoveryEnrichment,
  getDiscovery,
  getDiscoveryAgents,
  getDiscoveryDiff,
  onDiscoveryProgress,
  startDiscovery,
} from "../lib/storage";
import type { DiscoveryAgent, DiscoveryEstimate } from "../lib/desktop";
import type { DiscoveryEntry, DiscoveryFeature, DiscoveryIndex } from "../lib/types";

/** Thousands separators only; token counts are estimates, not measurements. */
function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined).format(Math.round(value));
}

/**
 * Sub-cent runs are the normal case on Haiku, and rendering those as "$0.00"
 * reads as free rather than as cheap, so anything under a cent gets an explicit
 * "less than" form instead of being rounded away.
 */
function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function timeAgo(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "never";
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const statusTones: Record<string, string> = {
  current: "tone-green",
  changed: "tone-orange",
  new: "tone-blue",
  stale: "tone-gray",
  never: "tone-gray",
};

const confidenceLabels: Record<string, string> = {
  high: "High",
  medium: "Med",
  low: "Low",
};

function cx(...classes: Array<false | null | string | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Brand mark for an agent. `onAccent` is for icons sitting on the agent's own
 * solid-color button (always the light glyph, since that background never
 * changes with the page theme); without it the icon sits on ordinary panel
 * background and must follow the page's light/dark theme instead.
 */
function AgentIcon({ agentId, size = 15, onAccent = false }: { agentId: string; size?: number; onAccent?: boolean }) {
  if (agentId === "codex") {
    if (onAccent) return <Image className="agent-icon" src="/openai-dark.png" alt="" width={size} height={size} />;
    return (
      <span className="agent-icon agent-icon-themed" aria-hidden="true">
        <Image className="theme-icon-light" src="/openai.png" alt="" width={size} height={size} />
        <Image className="theme-icon-dark" src="/openai-dark.png" alt="" width={size} height={size} />
      </span>
    );
  }
  return <Image className="agent-icon" src="/claude.png" alt="" width={size} height={size} />;
}

function DiscoveryCard({ entry, onClose }: { entry: DiscoveryEntry; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal discovery-card-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">Discovered File</span>
            <h2><Code2 size={16} /> {entry.filePath}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="discovery-card-body">
          <div className="discovery-card-section">
            <span className="field-label">Purpose</span>
            <p>{entry.purpose}</p>
          </div>
          {entry.importantExports.length > 0 && (
            <div className="discovery-card-section">
              <span className="field-label">Key Exports</span>
              <div className="tag-list">
                {entry.importantExports.map((exp) => <span className="card-tag tone-violet" key={exp}><Code2 size={10} /> {exp}</span>)}
              </div>
            </div>
          )}
          {entry.relatedFiles.length > 0 && (
            <div className="discovery-card-section">
              <span className="field-label">Related Files</span>
              <ul className="related-file-list">
                {entry.relatedFiles.map((rf) => <li key={rf}><FileText size={12} /> {rf}</li>)}
              </ul>
            </div>
          )}
          {entry.features.length > 0 && (
            <div className="discovery-card-section">
              <span className="field-label">Features</span>
              <div className="tag-list">
                {entry.features.map((f) => <span className="card-tag tone-blue" key={f}><Code2 size={10} /> {f}</span>)}
              </div>
            </div>
          )}
          {entry.dependencies.length > 0 && (
            <div className="discovery-card-section">
              <span className="field-label">Dependencies</span>
              <ul className="related-file-list">
                {entry.dependencies.map((dep) => <li key={dep}><FileText size={12} /> {dep}</li>)}
              </ul>
            </div>
          )}
          <div className="discovery-card-meta">
            <div><Clock3 size={13} /> Modified {formatTime(entry.lastModified)}</div>
            <div><RefreshCw size={13} /> Discovered {formatTime(entry.lastDiscovered)} by {entry.discoveredBy}</div>
            <div className={`confidence-badge ${entry.confidence}`}>Confidence: {confidenceLabels[entry.confidence] ?? entry.confidence}</div>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * The spend gate. Clicking "Discover with ..." opens this instead of starting a
 * run, so a click can never spend tokens before the user has seen what it will
 * cost and which model will do it.
 *
 * The estimate is presented as a range and labelled approximate on purpose.
 * Two identical codex runs were measured at 15,900 and 17,377 tokens, so a
 * single exact-looking figure would be false precision — and the excerpt sizing
 * assumes buildPrompt's 1600-char cap, which is a bound rather than a promise.
 */
function EnrichmentConfirm({
  agent,
  model,
  onModelChange,
  estimate,
  estimating,
  error,
  onConfirm,
  onClose,
}: {
  agent: DiscoveryAgent;
  model: string;
  onModelChange: (model: string) => void;
  estimate: DiscoveryEstimate | null;
  estimating: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const nothingToDo = estimate !== null && estimate.files === 0;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal discovery-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discovery-confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">Agent Enrichment</span>
            <h2 id="discovery-confirm-title">
              <AgentIcon agentId={agent.id} size={16} /> Discover with {agent.label}
            </h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="discovery-confirm-body">
          <p className="discovery-confirm-lede">
            The local index is already built and free. This step sends file excerpts to {agent.label} so each
            file gets a real written purpose instead of a pattern-matched guess.
          </p>

          <label className="field">
            <span className="field-label">Model</span>
            <select
              value={model}
              onChange={(event) => onModelChange(event.target.value)}
              disabled={agent.models.length <= 1}
            >
              {agent.models.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          {agent.id === "codex" && (
            <p className="field-hint">
              Codex runs whatever model <code>~/.codex/config.toml</code> selects. Explicit model ids are
              rejected on a ChatGPT account, so there is nothing else to choose here.
            </p>
          )}

          {estimating && (
            <div className="discovery-estimate loading">
              <RefreshCw size={15} className="spin" /> Estimating cost...
            </div>
          )}

          {error !== null && (
            <div className="discovery-estimate error" role="alert">
              <AlertTriangle size={15} /> {error}
            </div>
          )}

          {estimate !== null && !estimating && (
            <div className={cx("discovery-estimate", nothingToDo && "neutral")} role="status">
              <AlertTriangle size={15} />
              {nothingToDo ? (
                <div>
                  <strong>Nothing to enrich.</strong>
                  <span>Every indexed file already has an agent-written purpose.</span>
                </div>
              ) : (
                <div>
                  <strong>
                    Estimated ~{formatTokens(estimate.inputTokens + estimate.outputTokens)} tokens
                    {estimate.costUsd !== null && <> &middot; about {formatUsd(estimate.costUsd)}</>}
                  </strong>
                  <span>
                    {estimate.files} file{estimate.files === 1 ? "" : "s"} across {estimate.batches}{" "}
                    request{estimate.batches === 1 ? "" : "s"} &middot; {formatTokens(estimate.inputTokens)} in,{" "}
                    {formatTokens(estimate.outputTokens)} out.
                  </span>
                  <span className="discovery-estimate-caveat">
                    An estimate, not a quote — measured runs varied by roughly 10%.
                    {estimate.costUsd === null && " Codex bills against your ChatGPT plan, so no dollar figure is shown."}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button
            className="primary-button"
            type="button"
            onClick={onConfirm}
            disabled={estimating || nothingToDo || estimate === null}
          >
            <Sparkles size={15} /> Run Enrichment
          </button>
        </div>
      </section>
    </div>
  );
}

interface DiscoveryViewProps {
  repoPath: string;
  discovery: DiscoveryIndex | undefined;
  onDiscoveryUpdate?: (discovery: DiscoveryIndex) => void;
}

export function DiscoveryView({ repoPath, discovery, onDiscoveryUpdate }: DiscoveryViewProps) {
  const [scanning, setScanning] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<DiscoveryEntry | null>(null);
  const [search, setSearch] = useState("");
  const [showFeatures, setShowFeatures] = useState(false);
  const [diffInfo, setDiffInfo] = useState<{ changed: string[]; added: string[]; deleted: string[] } | null>(null);

  // The component used to read entries straight from props, which hold the
  // STORED index — and stored status is always "current" because it is written
  // at scan time. getDiscovery() returns the same index with status derived
  // against the files on disk, which is the only version worth showing.
  const [liveDiscovery, setLiveDiscovery] = useState<DiscoveryIndex | null>(null);

  const [agents, setAgents] = useState<DiscoveryAgent[]>([]);
  const [modelByAgent, setModelByAgent] = useState<Record<string, string>>({});
  const [pendingAgent, setPendingAgent] = useState<DiscoveryAgent | null>(null);
  const [estimate, setEstimate] = useState<DiscoveryEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const [enriching, setEnriching] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number; phase: string } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<string | null>(null);
  /** Files the user ticked for a targeted run. Empty means "everything unenriched". */
  const [selection, setSelection] = useState<string[]>([]);

  // Bumped on every openEnrichment call and every close, so a scan/estimate that
  // resolves after the user has already backed out of the modal is discarded
  // instead of silently landing state (and a full local scan) for a dialog no
  // one is looking at anymore.
  const enrichRequestRef = useRef(0);

  const effective = liveDiscovery ?? discovery;
  const entries = useMemo(() => effective?.entries ?? [], [effective?.entries]);
  const features = useMemo(() => effective?.features ?? [], [effective?.features]);
  const hasDiscovery = entries.length > 0;
  const unenrichedCount = entries.filter((e) => e.enriched !== true).length;

  const refreshDiscovery = useCallback(async () => {
    if (!repoPath) return;
    const live = await getDiscovery(repoPath);
    if (live !== null) setLiveDiscovery(live);
  }, [repoPath]);

  // Derived status has to be recomputed against disk, not read from props.
  // Keyed on version so a write from anywhere — this view, another window, or a
  // plugin hook running with the app closed — pulls the fresh index.
  const discoveryVersion = discovery?.version;
  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    void (async () => {
      const live = await getDiscovery(repoPath);
      if (live !== null && !cancelled) setLiveDiscovery(live);
    })();
    return () => { cancelled = true; };
  }, [repoPath, discoveryVersion]);

  useEffect(() => {
    let cancelled = false;
    void getDiscoveryAgents().then((list) => {
      if (cancelled) return;
      setAgents(list);
      setModelByAgent((current) => {
        const next = { ...current };
        for (const agent of list) if (next[agent.id] === undefined) next[agent.id] = agent.defaultModel;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, []);

  // Progress arrives on a main-process channel keyed by repo; a stale event for
  // another repository must not drive this view's bar. The ref is synced in an
  // effect rather than during render — a render-phase ref write is not safe
  // under concurrent rendering, where a render can be discarded or replayed.
  const repoPathRef = useRef(repoPath);
  useEffect(() => { repoPathRef.current = repoPath; }, [repoPath]);
  useEffect(() => onDiscoveryProgress((update) => {
    if (update.repoPath !== repoPathRef.current) return;
    setProgress({ completed: update.completed, total: update.total, phase: update.phase });
  }), []);

  const indexedCount = entries.length;
  const changedCount = entries.filter((e) => e.status === "changed").length;
  const newCount = entries.filter((e) => e.status === "new").length;
  const staleCount = discovery?.staleRelationshipCount ?? 0;

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    void (async () => {
      const result = await getDiscoveryDiff(repoPath);
      if (result && !cancelled) {
        const diff = result as { changed: string[]; added: string[]; deleted: string[]; needsFullDiscovery?: boolean };
        if (diff.needsFullDiscovery) return;
        setDiffInfo({ changed: diff.changed, added: diff.added, deleted: diff.deleted });
      }
    })();
    return () => { cancelled = true; };
  }, [repoPath]);

  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (e) =>
        e.filePath.toLowerCase().includes(q) ||
        e.purpose.toLowerCase().includes(q) ||
        e.features.some((f) => f.toLowerCase().includes(q)) ||
        e.importantExports.some((exp) => exp.toLowerCase().includes(q)),
    );
  }, [entries, search]);

  const filteredFeatures = useMemo(() => {
    if (!search.trim()) return features;
    const q = search.toLowerCase();
    return features.filter((f) => f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q));
  }, [features, search]);

  /**
   * Opens the spend gate for an agent. The heuristic index is built first when
   * it is missing, because it is local, free, and the estimate cannot be
   * computed without it — the main process needs a candidate list to size.
   */
  async function openEnrichment(agent: DiscoveryAgent) {
    if (!repoPath) return;
    const requestId = ++enrichRequestRef.current;
    setPendingAgent(agent);
    setEstimate(null);
    setEstimateError(null);
    setEstimating(true);
    setRunError(null);
    setRunSummary(null);

    try {
      if (!hasDiscovery) {
        setScanning(true);
        try {
          const scanned = await startDiscovery(repoPath, { discoveredBy: agent.id });
          // The user may have closed the modal while the scan was in flight.
          // The scan itself already happened (it's local/free and future opens
          // benefit from it), but the result must not resurrect a dismissed dialog.
          if (enrichRequestRef.current !== requestId) return;
          if (scanned !== null) {
            setLiveDiscovery(scanned);
            onDiscoveryUpdate?.(scanned);
          }
          setDiffInfo(null);
        } finally {
          setScanning(false);
        }
      }

      const input: { repoPath: string; agent: string; model?: string; filePaths?: string[] } = {
        repoPath,
        agent: agent.id,
      };
      const model = modelByAgent[agent.id];
      if (model !== undefined && model !== "") input.model = model;
      if (selection.length > 0) input.filePaths = selection;

      const result = await estimateDiscoveryEnrichment(input);
      if (enrichRequestRef.current !== requestId) return;
      setEstimate(result);
    } catch (err) {
      if (enrichRequestRef.current !== requestId) return;
      setEstimateError(err instanceof Error ? err.message : String(err));
    } finally {
      if (enrichRequestRef.current === requestId) setEstimating(false);
    }
  }

  /** Re-prices without re-scanning when the user switches model mid-dialog. */
  async function repriceFor(agent: DiscoveryAgent, model: string) {
    if (!repoPath) return;
    setEstimating(true);
    setEstimateError(null);
    try {
      const input: { repoPath: string; agent: string; model?: string; filePaths?: string[] } = {
        repoPath,
        agent: agent.id,
      };
      if (model !== "") input.model = model;
      if (selection.length > 0) input.filePaths = selection;
      setEstimate(await estimateDiscoveryEnrichment(input));
    } catch (err) {
      setEstimateError(err instanceof Error ? err.message : String(err));
    } finally {
      setEstimating(false);
    }
  }

  async function runEnrichment() {
    const agent = pendingAgent;
    if (agent === null || !repoPath) return;
    setPendingAgent(null);
    setEnriching(true);
    setRunError(null);
    setRunSummary(null);
    setProgress({ completed: 0, total: 1, phase: `Starting ${agent.label}...` });

    try {
      const input: { repoPath: string; agent: string; model?: string; filePaths?: string[] } = {
        repoPath,
        agent: agent.id,
      };
      const model = modelByAgent[agent.id];
      if (model !== undefined && model !== "") input.model = model;
      if (selection.length > 0) input.filePaths = selection;

      const result = await enrichDiscovery(input);
      if (result !== null) {
        setLiveDiscovery(result);
        onDiscoveryUpdate?.(result);
        setSelection([]);

        // A run can succeed partially. Reporting that as a plain success would
        // hide real work that did not happen, so the count is always stated and
        // the failure is named alongside it rather than replacing it.
        if (result.failed.length > 0) {
          setRunSummary(`${result.enriched} enriched, ${result.failed.length} failed.`);
          setRunError(result.error ?? "Some files could not be enriched.");
        } else if (result.error === "cancelled") {
          setRunSummary(`Cancelled after enriching ${result.enriched} file${result.enriched === 1 ? "" : "s"}.`);
        } else if (result.alreadyComplete === true) {
          setRunSummary("Everything was already enriched.");
        } else {
          setRunSummary(`Enriched ${result.enriched} file${result.enriched === 1 ? "" : "s"} with ${agent.label}.`);
        }
      }
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnriching(false);
      setProgress(null);
      void refreshDiscovery();
    }
  }

  async function handleCancelRun() {
    if (!repoPath) return;
    await cancelDiscoveryEnrichment(repoPath);
  }

  /** Plain re-index: local, free, no agent involved. */
  async function handleScan() {
    if (!repoPath) return;
    setScanning(true);
    setRunError(null);
    try {
      const result = await startDiscovery(repoPath, { force: true });
      if (result !== null) {
        setLiveDiscovery(result);
        onDiscoveryUpdate?.(result);
      }
      setDiffInfo(null);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
      void refreshDiscovery();
    }
  }

  function toggleSelected(filePath: string) {
    setSelection((current) => (
      current.includes(filePath) ? current.filter((p) => p !== filePath) : [...current, filePath]
    ));
  }

  if (!repoPath) {
    return (
      <div className="discovery-view">
        <div className="record-list-heading">
          <div>
            <span className="eyebrow">Project Discovery</span>
            <h2>Codebase Intelligence Index</h2>
          </div>
        </div>
        <div className="empty-state">
          <Search size={24} />
          <h3>No Directory Selected</h3>
          <p>Select a directory to enable codebase discovery.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="discovery-view">
      <div className="record-list-heading">
        <div>
          <span className="eyebrow">Project Discovery</span>
          <h2>Codebase Intelligence Index</h2>
        </div>
        <div className="discovery-actions">
          {hasDiscovery && (
            <button className="ghost-button compact" type="button" onClick={() => { void handleScan(); }} disabled={scanning || enriching}>
              <RefreshCw size={15} className={cx(scanning && "spin")} /> {scanning ? "Re-indexing..." : "Re-index"}
            </button>
          )}
          {agents.map((agent) => (
            <button
              key={agent.id}
              className={cx("agent-button", "compact", `agent-${agent.id}`)}
              type="button"
              onClick={() => { void openEnrichment(agent); }}
              disabled={scanning || enriching}
            >
              <AgentIcon agentId={agent.id} onAccent />
              {hasDiscovery ? `Enrich with ${agent.label}` : `Discover with ${agent.label}`}
              {hasDiscovery && unenrichedCount > 0 && (
                <span className="agent-button-count">
                  {selection.length > 0 ? selection.length : unenrichedCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {!hasDiscovery && !scanning && (
        <div className="empty-state">
          <Search size={24} />
          <h3>No Discovery Data</h3>
          <p>Run &ldquo;Discover with Claude&rdquo; or &ldquo;Discover with Codex&rdquo; to build the codebase intelligence index for this directory.</p>
        </div>
      )}

      {scanning && (
        <div className="discovery-scanning">
          <RefreshCw size={20} className="spin" />
          <span>Scanning repository files...</span>
        </div>
      )}

      {enriching && (
        <div className="discovery-progress" role="status" aria-live="polite">
          <div className="discovery-progress-head">
            <RefreshCw size={16} className="spin" />
            <span>{progress?.phase ?? "Working..."}</span>
            <button className="ghost-button compact" type="button" onClick={() => { void handleCancelRun(); }}>
              <X size={14} /> Cancel
            </button>
          </div>
          <div
            className="discovery-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress?.total ?? 1}
            aria-valuenow={progress?.completed ?? 0}
          >
            <div
              className="discovery-progress-fill"
              style={{ width: `${progress === null || progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * 100)}%` }}
            />
          </div>
          {progress !== null && progress.total > 0 && (
            <span className="discovery-progress-count">{progress.completed} of {progress.total} batches</span>
          )}
        </div>
      )}

      {(runError !== null || runSummary !== null) && !enriching && (
        <div className={cx("discovery-run-result", runError !== null && "error")} role="status">
          {runError !== null ? <AlertTriangle size={15} /> : <Sparkles size={15} />}
          <div>
            {runSummary !== null && <strong>{runSummary}</strong>}
            {runError !== null && <span>{runError}</span>}
          </div>
          <button className="icon-button" type="button" aria-label="Dismiss" onClick={() => { setRunError(null); setRunSummary(null); }}>
            <X size={15} />
          </button>
        </div>
      )}

      {hasDiscovery && (
        <>
          <div className="discovery-summary">
            <div className="discovery-stat"><strong>{indexedCount}</strong><span>files indexed</span></div>
            <div className="discovery-stat"><strong>{features.length}</strong><span>features</span></div>
            <div className="discovery-stat">
              <strong>{entries.length - unenrichedCount}/{entries.length}</strong><span>agent-written</span>
            </div>
            <div className="discovery-stat">{changedCount > 0 ? <span className="changed-text">{changedCount} changed</span> : <span className="current-text">No changes</span>}<span>since last scan</span></div>
            {newCount > 0 && <div className="discovery-stat"><strong className="new-text">{newCount}</strong><span>new files</span></div>}
            {diffInfo && diffInfo.deleted.length > 0 && <div className="discovery-stat"><strong className="stale-text">{diffInfo.deleted.length}</strong><span>deleted</span></div>}
            {staleCount > 0 && <div className="discovery-stat"><strong className="stale-text">{staleCount}</strong><span>stale relations</span></div>}
            {discovery?.lastFullDiscovery && <div className="discovery-stat"><Clock3 size={14} /><span>{timeAgo(discovery.lastFullDiscovery)}</span></div>}
          </div>

          <div className="discovery-toolbar">
            <label className="global-search discovery-search">
              <Search size={16} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files and features..." />
            </label>
            <button
              className={cx("secondary-button compact", showFeatures && "active")}
              type="button"
              onClick={() => setShowFeatures((v) => !v)}
            >
              <Code2 size={15} /> {showFeatures ? "Show Files" : "Show Features"}
            </button>
          </div>

          {showFeatures ? (
            <section className="discovery-features">
              {filteredFeatures.length === 0 && <div className="empty-state"><Search size={20} /><h3>No matching features</h3></div>}
              {filteredFeatures.map((feature: DiscoveryFeature) => (
                <div className="decision-card panel" key={feature.name}>
                  <div className="discovery-feature-header">
                    <Code2 size={16} />
                    <div>
                      <h3>{feature.name}</h3>
                      <p>{feature.description}</p>
                    </div>
                    <span className="feature-file-count">{feature.filePaths.length} files</span>
                  </div>
                  <div className="feature-files">
                    {feature.filePaths.map((fp) => (
                      <span className="card-tag tone-blue" key={fp}><FileText size={10} /> {fp}</span>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ) : (
            <section className="discovery-files">
              <div className="discovery-table-header">
                <span className="discovery-col-file">File</span>
                <span className="discovery-col-purpose">Purpose</span>
                <span className="discovery-col-modified">Modified</span>
                <span className="discovery-col-discovered">Discovered</span>
                <span className="discovery-col-status">Status</span>
              </div>
              {filteredEntries.length === 0 && <div className="empty-state"><Search size={20} /><h3>No matching files</h3></div>}
              {filteredEntries.map((entry: DiscoveryEntry) => (
                <div className={cx("discovery-row", selection.includes(entry.filePath) && "selected")} key={entry.filePath}>
                  <input
                    type="checkbox"
                    className="discovery-row-select"
                    checked={selection.includes(entry.filePath)}
                    onChange={() => toggleSelected(entry.filePath)}
                    aria-label={`Select ${entry.filePath} for enrichment`}
                  />
                  <button className="discovery-row-main" type="button" onClick={() => setSelectedEntry(entry)}>
                  <span className="discovery-col-file"><Code2 size={13} /> {entry.filePath}</span>
                  <span className="discovery-col-purpose">
                    {/* An agent-written purpose and a regex guess look identical
                        otherwise, and the difference is what the user paid for. */}
                    {entry.enriched === true && <span className="enriched-badge" title="Written by an agent"><Sparkles size={10} /></span>}
                    {entry.purpose}
                  </span>
                  <span className="discovery-col-modified">{timeAgo(entry.lastModified)}</span>
                  <span className="discovery-col-discovered">{timeAgo(entry.lastDiscovered)}</span>
                  <span className={cx("discovery-col-status", `status-${entry.status}`)}>
                    <span className={`status-dot ${statusTones[entry.status] ?? "tone-gray"}`} />
                    {entry.status}
                  </span>
                  </button>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {selectedEntry !== null && <DiscoveryCard entry={selectedEntry} onClose={() => setSelectedEntry(null)} />}

      {pendingAgent !== null && (
        <EnrichmentConfirm
          agent={pendingAgent}
          model={modelByAgent[pendingAgent.id] ?? pendingAgent.defaultModel}
          onModelChange={(model) => {
            setModelByAgent((current) => ({ ...current, [pendingAgent.id]: model }));
            void repriceFor(pendingAgent, model);
          }}
          estimate={estimate}
          estimating={estimating || scanning}
          error={estimateError}
          onConfirm={() => { void runEnrichment(); }}
          onClose={() => {
            enrichRequestRef.current += 1;
            setPendingAgent(null);
            setEstimate(null);
            setEstimateError(null);
          }}
        />
      )}
    </div>
  );
}

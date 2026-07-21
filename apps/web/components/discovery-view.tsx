"use client";

import { Clock3, Code2, FileText, RefreshCw, Search, Terminal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { startDiscovery, getDiscoveryDiff } from "../lib/storage";
import type { DiscoveryEntry, DiscoveryFeature, DiscoveryIndex } from "../lib/types";

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

  const entries = useMemo(() => discovery?.entries ?? [], [discovery?.entries]);
  const features = useMemo(() => discovery?.features ?? [], [discovery?.features]);
  const hasDiscovery = entries.length > 0;

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

  async function handleScan() {
    if (!repoPath) return;
    setScanning(true);
    try {
      const result = await startDiscovery(repoPath);
      if (result && onDiscoveryUpdate) {
        onDiscoveryUpdate(result);
      }
      setDiffInfo(null);
    } catch (err) {
      console.error("Discovery scan failed", err);
    } finally {
      setScanning(false);
    }
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
          {!hasDiscovery && !scanning && (
            <>
              <button className="primary-button compact" type="button" onClick={() => { void handleScan(); }} disabled={scanning}>
                <Code2 size={15} className={cx(scanning && "spin")} /> {scanning ? "Scanning..." : "Discover with Claude"}
              </button>
              <button className="secondary-button compact" type="button" onClick={() => { void handleScan(); }} disabled={scanning}>
                <Terminal size={15} className={cx(scanning && "spin")} /> {scanning ? "Scanning..." : "Discover with Codex"}
              </button>
            </>
          )}
          {hasDiscovery && (
            <>
              <button className="primary-button compact" type="button" onClick={() => { void handleScan(); }} disabled={scanning}>
                <RefreshCw size={15} className={cx(scanning && "spin")} /> {scanning ? "Updating..." : "Rediscover with Claude"}
              </button>
              <button className="secondary-button compact" type="button" onClick={() => { void handleScan(); }} disabled={scanning}>
                <RefreshCw size={15} className={cx(scanning && "spin")} /> {scanning ? "Updating..." : "Rediscover with Codex"}
              </button>
            </>
          )}
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

      {hasDiscovery && (
        <>
          <div className="discovery-summary">
            <div className="discovery-stat"><strong>{indexedCount}</strong><span>files indexed</span></div>
            <div className="discovery-stat"><strong>{features.length}</strong><span>features</span></div>
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
                <button className="discovery-row" type="button" key={entry.filePath} onClick={() => setSelectedEntry(entry)}>
                  <span className="discovery-col-file"><Code2 size={13} /> {entry.filePath}</span>
                  <span className="discovery-col-purpose">{entry.purpose}</span>
                  <span className="discovery-col-modified">{timeAgo(entry.lastModified)}</span>
                  <span className="discovery-col-discovered">{timeAgo(entry.lastDiscovered)}</span>
                  <span className={cx("discovery-col-status", `status-${entry.status}`)}>
                    <span className={`status-dot ${statusTones[entry.status] ?? "tone-gray"}`} />
                    {entry.status}
                  </span>
                </button>
              ))}
            </section>
          )}
        </>
      )}

      {selectedEntry !== null && <DiscoveryCard entry={selectedEntry} onClose={() => setSelectedEntry(null)} />}
    </div>
  );
}

"use client";

import { suggestCommit } from "@relay/domain";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  CheckSquare2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileCode2,
  Folder,
  FolderGit2,
  FolderOpen,
  GitCommitHorizontal,
  GitCompareArrows,
  GitPullRequestArrow,
  History,
  LoaderCircle,
  MinusSquare,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import type {
  RelayGitCommit,
  RelayGitComparison,
  RelayGitExecutionResult,
  RelayGitFileChange,
  RelayGitPreparedPlan,
  RelayGitStatus,
} from "../lib/desktop";
import { useEscapeKey, useFocusTrap } from "./ui-primitives";

interface CommitGroup {
  description: string;
  id: string;
  message: string;
  messageEdited: boolean;
}

interface TreeFile {
  originalPath?: string;
  path: string;
  state: RelayGitFileChange["state"];
}

interface TreeNode {
  children: TreeNode[];
  file?: TreeFile;
  files: TreeFile[];
  id: string;
  name: string;
  path: string;
}

type PanelMode = "activity" | "changes" | "history";
type PanelPhase = "editor" | "review";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : "Relay could not complete the Git action.";
}

function stateLabel(state: RelayGitFileChange["state"]): string {
  return { added: "Added", conflicted: "Conflict", deleted: "Deleted", modified: "Modified", renamed: "Renamed", untracked: "Untracked" }[state];
}

function stateCode(state: RelayGitFileChange["state"]): string {
  return { added: "A", conflicted: "!", deleted: "D", modified: "M", renamed: "R", untracked: "U" }[state];
}

function relativeCommitDate(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d` : new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function suggestionFor(status: RelayGitStatus, paths: string[]) {
  const selected = status.files.filter((file) => paths.includes(file.path));
  return suggestCommit(selected.map((file) => ({
    additions: file.additions,
    deletions: file.deletions,
    path: file.path,
    status: file.state,
  })));
}

function buildTree(files: TreeFile[]): TreeNode[] {
  const root: TreeNode = { children: [], files: files, id: "", name: "", path: "" };
  for (const file of files) {
    const parts = file.path.split("/");
    let parent = root;
    for (const [index, part] of parts.entries()) {
      const nodePath = parts.slice(0, index + 1).join("/");
      let child = parent.children.find((candidate) => candidate.name === part);
      if (child === undefined) {
        child = { children: [], files: [], id: nodePath, name: part, path: nodePath };
        parent.children.push(child);
      }
      child.files.push(file);
      if (index === parts.length - 1) child.file = file;
      parent = child;
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((left, right) => Number(left.file !== undefined) - Number(right.file !== undefined) || left.name.localeCompare(right.name));
    for (const node of nodes) sort(node.children);
  };
  sort(root.children);
  return root.children;
}

function allFolderPaths(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) => node.file === undefined ? [node.path, ...allFolderPaths(node.children)] : []);
}

function FileTreeSection({
  activePath,
  assignments,
  files,
  label,
  onOpenFile,
  onTogglePaths,
  query,
  sectionId,
}: {
  activePath: string | null;
  assignments?: Record<string, string | null>;
  files: TreeFile[];
  label: string;
  onOpenFile: (path: string) => void;
  onTogglePaths?: (paths: string[]) => void;
  query: string;
  sectionId: string;
}) {
  const visibleFiles = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized === "" ? files : files.filter((file) => file.path.toLowerCase().includes(normalized));
  }, [files, query]);
  const nodes = useMemo(() => buildTree(visibleFiles), [visibleFiles]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const visibleExpanded = useMemo(
    () => {
      const activeAncestors = activePath === null || !visibleFiles.some((file) => file.path === activePath)
        ? []
        : activePath.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"));
      return new Set([...expanded, ...(query.trim() === "" ? [] : allFolderPaths(nodes)), ...activeAncestors]);
    },
    [activePath, expanded, nodes, query, visibleFiles],
  );

  function selectedState(paths: string[]) {
    if (assignments === undefined) return "none";
    const selected = paths.filter((path) => assignments[path] !== null && assignments[path] !== undefined).length;
    return selected === 0 ? "none" : selected === paths.length ? "all" : "some";
  }

  function renderNode(node: TreeNode, depth: number) {
    const folder = node.file === undefined;
    const open = visibleExpanded.has(node.path);
    const selection = selectedState(node.files.map((file) => file.path));
    return (
      <div key={`${sectionId}:${node.id}`} className="git-tree-node" role="treeitem" aria-expanded={folder ? open : undefined} aria-level={depth + 1} aria-selected={activePath === node.file?.path}>
        <div className={`git-tree-row${assignments === undefined ? " no-selection" : ""}${activePath === node.file?.path ? " active" : ""}`} style={{ "--tree-depth": depth } as CSSProperties}>
          {folder ? (
            <button className="git-tree-disclosure" type="button" aria-label={`${open ? "Collapse" : "Expand"} ${node.path}`} onClick={() => setExpanded((current) => { const next = new Set(current); if (open) next.delete(node.path); else next.add(node.path); return next; })}>
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : <span className="git-tree-indent" />}
          {assignments !== undefined && onTogglePaths !== undefined && (
            <button className="git-tree-check" type="button" aria-label={`${selection === "all" ? "Exclude" : "Include"} ${node.path}`} aria-pressed={selection === "all"} onClick={() => onTogglePaths(node.files.map((file) => file.path))}>
              {selection === "all" ? <CheckSquare2 size={14} /> : selection === "some" ? <MinusSquare size={14} /> : <Square size={14} />}
            </button>
          )}
          <button className="git-tree-name" type="button" onClick={() => folder ? setExpanded((current) => { const next = new Set(current); if (open) next.delete(node.path); else next.add(node.path); return next; }) : onOpenFile(node.file?.path ?? node.path)}>
            {folder ? open ? <FolderOpen size={14} /> : <Folder size={14} /> : <FileCode2 size={13} />}
            <span>{node.name}</span>
            {folder ? <small>{node.files.length}</small> : <><span className={`git-state-code ${node.file?.state}`}>{stateCode(node.file?.state ?? "modified")}</span>{node.file?.originalPath !== undefined && <small title={node.file.originalPath}>renamed</small>}</>}
          </button>
        </div>
        {folder && open && <div role="group">{node.children.map((child) => renderNode(child, depth + 1))}</div>}
      </div>
    );
  }

  return (
    <section className="git-tree-section" aria-labelledby={`${sectionId}-label`}>
      <header><h3 id={`${sectionId}-label`}>{label}</h3><span>{visibleFiles.length}{visibleFiles.length !== files.length ? ` / ${files.length}` : ""}</span></header>
      {visibleFiles.length === 0 ? <p className="git-tree-empty">{query.trim() === "" ? `No ${label.toLowerCase()} changes` : "No matching files"}</p> : <div className="git-file-tree" role="tree">{nodes.map((node) => renderNode(node, 0))}</div>}
    </section>
  );
}

function DiffViewer({ diff, error, loading, path }: { diff: Pick<RelayGitFileChange, "additions" | "binary" | "deletions" | "patch" | "reviewable" | "reviewError" | "risks" | "state"> | null; error: string | null; loading: boolean; path: string | null }) {
  if (path === null) return <div className="git-diff-empty"><FileCode2 size={22} /><h3>Select a changed file</h3><p>Review its complete patch before adding it to a commit.</p></div>;
  return (
    <section className="git-diff-view" aria-label={`Diff for ${path}`}>
      <header><div><code title={path}>{path}</code>{diff !== null && <span className={`git-state-label ${diff.state}`}>{stateLabel(diff.state)}</span>}</div>{diff !== null && <span className="git-lines"><b>+{diff.additions}</b><i>-{diff.deletions}</i></span>}</header>
      {loading && <div className="git-diff-skeleton" aria-label={`Loading diff for ${path}`}><LoaderCircle className="spin" size={18} /><span>Reading this patch…</span></div>}
      {error !== null && <div className="git-inline-error" role="alert"><AlertTriangle size={15} />{error}</div>}
      {!loading && diff !== null && <pre>{diff.patch || (diff.binary ? "Binary content changed." : "Git reported a metadata-only change.")}</pre>}
    </section>
  );
}

function TerminalResult({ result }: { result: RelayGitExecutionResult }) {
  return (
    <div className="git-terminal" role="log" aria-live="polite">
      <div className="git-terminal-bar"><i /><i /><i /><span>relay git activity</span></div>
      <pre>{[
        `$ branch: ${result.branch ?? "detached HEAD"}`,
        `$ remote: ${result.remote ?? "none"}${result.remoteUrl === null ? "" : ` (${result.remoteUrl})`}`,
        "",
        ...result.commands.map((command) => `$ ${command}`),
        "",
        ...result.commits.flatMap((commit, index) => [`[commit ${index + 1}] ${commit.message}`, `hash ${commit.hash}`, ...commit.files.map((file) => `  + ${file}`)]),
        ...(result.push === null ? ["", "push: not requested"] : ["", `push: ${result.push.success ? "succeeded" : "failed"}`, result.push.output]),
        ...result.warnings.flatMap((warning) => ["", `warning: ${warning}`]),
        ...result.errors.flatMap((message) => ["", `error: ${message}`]),
        "",
        result.success ? "✓ Git workflow completed." : "✕ Git workflow finished with errors.",
      ].join("\n")}</pre>
    </div>
  );
}

export function GitCommitPanel({ boardId, boardName, onClose }: { boardId: string; boardName: string; onClose: () => void }) {
  const titleId = useId();
  const containerRef = useFocusTrap();
  const [mode, setMode] = useState<PanelMode>("changes");
  const [phase, setPhase] = useState<PanelPhase>("editor");
  const [status, setStatus] = useState<RelayGitStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [groups, setGroups] = useState<CommitGroup[]>([{ description: "", id: crypto.randomUUID(), message: "", messageEdited: false }]);
  const [assignments, setAssignments] = useState<Record<string, string | null>>({});
  const [activeGroupId, setActiveGroupId] = useState(groups[0]?.id ?? "");
  const [acknowledgedRisks, setAcknowledgedRisks] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [activePath, setActivePath] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, RelayGitFileChange>>({});
  const [diffLoadingPath, setDiffLoadingPath] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<RelayGitPreparedPlan | null>(null);
  const [result, setResult] = useState<RelayGitExecutionResult | null>(null);
  const [history, setHistory] = useState<RelayGitCommit[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySelection, setHistorySelection] = useState<string[]>([]);
  const [comparison, setComparison] = useState<RelayGitComparison | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonPath, setComparisonPath] = useState<string | null>(null);
  const [comparisonDiff, setComparisonDiff] = useState<RelayGitFileChange | null>(null);
  const [comparisonDiffLoading, setComparisonDiffLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscapeKey(onClose, !busy);

  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0];
  const assignedPaths = useMemo(() => Object.values(assignments).filter(Boolean).length, [assignments]);
  const stagedFiles = useMemo(() => status?.files.filter((file) => file.kind === "staged" || file.kind === "staged_modified") ?? [], [status]);
  const unstagedFiles = useMemo(() => status?.files.filter((file) => file.kind === "modified" || file.kind === "staged_modified" || file.kind === "untracked" || file.kind === "conflicted") ?? [], [status]);
  const orderedComparison = useMemo(() => historySelection.length !== 2 || history === null ? [] : [...historySelection].sort((left, right) => history.findIndex((commit) => commit.hash === right) - history.findIndex((commit) => commit.hash === left)), [history, historySelection]);

  function initializeStatus(nextStatus: RelayGitStatus) {
    const initialGroupId = crypto.randomUUID();
    const initialAssignments = Object.fromEntries(nextStatus.files.map((file) => [file.path, file.tracked && file.kind !== "conflicted" && file.risks.length === 0 ? initialGroupId : null]));
    const initialPaths = Object.entries(initialAssignments).filter(([, groupId]) => groupId === initialGroupId).map(([filePath]) => filePath);
    setStatus(nextStatus);
    setAssignments(initialAssignments);
    setGroups([{ description: "", id: initialGroupId, message: suggestionFor(nextStatus, initialPaths).message, messageEdited: false }]);
    setActiveGroupId(initialGroupId);
    setAcknowledgedRisks(new Set());
    setDiffs({});
    setPrepared(null);
    setPhase("editor");
    const firstPath = nextStatus.files[0]?.path ?? null;
    setActivePath(firstPath);
    if (firstPath !== null) void loadDiff(firstPath, true);
  }

  async function loadStatus() {
    setStatusLoading(true);
    setError(null);
    try {
      if (window.relayDesktop === undefined) throw new Error("Git actions are available only inside the Relay desktop app.");
      initializeStatus(await window.relayDesktop.getGitStatus({ boardId }));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setStatusLoading(false);
    }
  }

  async function loadDiff(filePath: string, force = false): Promise<RelayGitFileChange | null> {
    setActivePath(filePath);
    setDiffError(null);
    if (!force && diffs[filePath] !== undefined) return diffs[filePath];
    setDiffLoadingPath(filePath);
    try {
      if (window.relayDesktop === undefined) throw new Error("Git actions are available only inside the Relay desktop app.");
      const diff = await window.relayDesktop.getGitDiff({ boardId, path: filePath });
      setDiffs((current) => ({ ...current, [filePath]: diff }));
      setStatus((current) => current === null ? null : { ...current, files: current.files.map((file) => file.path === filePath ? diff : file) });
      return diff;
    } catch (loadError) {
      setDiffError(errorMessage(loadError));
      return null;
    } finally {
      setDiffLoadingPath((current) => current === filePath ? null : current);
    }
  }

  async function loadHistory(force = false) {
    if ((!force && history !== null) || historyLoading) return;
    setHistoryLoading(true);
    setError(null);
    try {
      if (window.relayDesktop === undefined) throw new Error("Git actions are available only inside the Relay desktop app.");
      setHistory(await window.relayDesktop.getGitHistory({ boardId, limit: 150 }));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => { void loadStatus(); }, 0);
    return () => window.clearTimeout(timeout);
    // Loader state changes must not restart the board-scoped status request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);
  useEffect(() => {
    if (mode !== "history") return;
    const timeout = window.setTimeout(() => { void loadHistory(); }, 0);
    return () => window.clearTimeout(timeout);
    // History is fetched once on entry and refreshed explicitly by the toolbar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      if (orderedComparison.length !== 2) {
        setComparison(null);
        setComparisonPath(null);
        setComparisonDiff(null);
        return;
      }
      setComparisonLoading(true);
      setError(null);
      void window.relayDesktop?.compareGitCommits({ boardId, base: orderedComparison[0] ?? "", head: orderedComparison[1] ?? "" }).then((next) => {
        if (active) setComparison(next);
      }).catch((compareError) => { if (active) setError(errorMessage(compareError)); }).finally(() => { if (active) setComparisonLoading(false); });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [boardId, orderedComparison]);

  function updateAssignments(next: Record<string, string | null>) {
    setAssignments(next);
    if (status === null) return;
    setGroups((current) => current.map((group) => {
      if (group.messageEdited) return group;
      const paths = Object.entries(next).filter(([, groupId]) => groupId === group.id).map(([filePath]) => filePath);
      return { ...group, message: suggestionFor(status, paths).message };
    }));
    setPrepared(null);
  }

  function togglePaths(paths: string[]) {
    if (status === null) return;
    const eligible = paths.filter((filePath) => status.files.find((file) => file.path === filePath)?.kind !== "conflicted");
    const allAssignedHere = eligible.length > 0 && eligible.every((filePath) => assignments[filePath] === activeGroupId);
    const next = { ...assignments };
    for (const filePath of eligible) next[filePath] = allAssignedHere ? null : activeGroupId;
    updateAssignments(next);
  }

  function addGroup() {
    const group = { description: "", id: crypto.randomUUID(), message: "", messageEdited: false };
    setGroups((current) => [...current, group]);
    setActiveGroupId(group.id);
  }

  function removeGroup(groupId: string) {
    if (groups.length === 1) return;
    const nextGroups = groups.filter((group) => group.id !== groupId);
    const nextAssignments = Object.fromEntries(Object.entries(assignments).map(([filePath, assigned]) => [filePath, assigned === groupId ? null : assigned]));
    setGroups(nextGroups);
    setActiveGroupId(nextGroups[0]?.id ?? "");
    updateAssignments(nextAssignments);
  }

  async function reviewPlan() {
    if (status === null || window.relayDesktop === undefined) return;
    const desktop = window.relayDesktop;
    setBusy(true);
    setError(null);
    try {
      const selectedPaths = Object.entries(assignments).filter(([, groupId]) => groupId !== null).map(([filePath]) => filePath);
      const loadedDiffs: RelayGitFileChange[] = [];
      for (let offset = 0; offset < selectedPaths.length; offset += 8) {
        const batch = await Promise.all(selectedPaths.slice(offset, offset + 8).map(async (filePath) => diffs[filePath] ?? await desktop.getGitDiff({ boardId, path: filePath })));
        loadedDiffs.push(...batch);
      }
      const nextDiffs = { ...diffs, ...Object.fromEntries(loadedDiffs.map((file) => [file.path, file])) };
      setDiffs(nextDiffs);
      setStatus((current) => current === null ? null : { ...current, files: current.files.map((file) => nextDiffs[file.path] ?? file) });
      const unacknowledged = loadedDiffs.filter((file) => file.risks.length > 0 && !acknowledgedRisks.has(file.path));
      if (unacknowledged.length > 0) {
        setActivePath(unacknowledged[0]?.path ?? null);
        setError(`Review and acknowledge ${unacknowledged.length} selected ${unacknowledged.length === 1 ? "file warning" : "file warnings"} before continuing.`);
        return;
      }
      const commits = groups.map((group) => ({
        id: group.id,
        message: [group.message.trim(), group.description.trim()].filter(Boolean).join("\n\n"),
        paths: Object.entries(assignments).filter(([, groupId]) => groupId === group.id).map(([filePath]) => filePath),
      })).filter((commit) => commit.paths.length > 0);
      setPrepared(await desktop.prepareGitCommits({ acknowledgedRiskPaths: [...acknowledgedRisks], boardId, commits, snapshotId: status.snapshotId }));
      setPhase("review");
    } catch (prepareError) {
      setError(errorMessage(prepareError));
    } finally {
      setBusy(false);
    }
  }

  async function executePlan(push: boolean) {
    if (prepared === null || window.relayDesktop === undefined) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await window.relayDesktop.executeGitCommits({ confirmationToken: prepared.confirmationToken, push }));
      setMode("activity");
      setPhase("editor");
    } catch (executeError) {
      setError(errorMessage(executeError));
    } finally {
      setBusy(false);
    }
  }

  async function pushBranch() {
    if (window.relayDesktop === undefined) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await window.relayDesktop.pushGitBranch({ boardId }));
      setMode("activity");
    } catch (pushError) {
      setError(errorMessage(pushError));
    } finally {
      setBusy(false);
    }
  }

  async function loadComparisonDiff(filePath: string) {
    if (orderedComparison.length !== 2 || window.relayDesktop === undefined) return;
    setComparisonPath(filePath);
    setComparisonDiff(null);
    setComparisonDiffLoading(true);
    try {
      const diff = await window.relayDesktop.getGitCommitDiff({ boardId, base: orderedComparison[0] ?? "", head: orderedComparison[1] ?? "", path: filePath });
      const file = comparison?.files.find((candidate) => candidate.path === filePath);
      setComparisonDiff({ ...diff, kind: "modified", ...(file?.originalPath === undefined ? {} : { originalPath: file.originalPath }), state: file?.state ?? "modified", tracked: true });
    } catch (compareError) {
      setError(errorMessage(compareError));
    } finally {
      setComparisonDiffLoading(false);
    }
  }

  const activeDiff = activePath === null ? null : diffs[activePath] ?? null;
  const selectedRisk = activeDiff?.risks.length ? activeDiff : null;
  const activeGroupPaths = activeGroup === undefined ? [] : Object.entries(assignments).filter(([, groupId]) => groupId === activeGroup.id).map(([filePath]) => filePath);
  const invalidCommit = groups.some((group) => Object.values(assignments).includes(group.id) && group.message.trim() === "");

  return (
    <div className="git-panel-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
      <section className="git-panel git-workbench-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={(node) => { containerRef.current = node; }} onMouseDown={(event) => event.stopPropagation()}>
        <header className="git-panel-header">
          <div className="git-panel-title"><span className="github-mark"><FolderGit2 size={18} /></span><div><span className="eyebrow">Git Workbench · {boardName}</span><h2 id={titleId}>{phase === "review" ? "Confirm Exact Commit Plan" : "Repository"}</h2></div></div>
          {phase === "editor" && <nav className="git-mode-tabs" aria-label="Git Workbench views">
            <button className={mode === "changes" ? "active" : ""} type="button" onClick={() => setMode("changes")}><GitCommitHorizontal size={14} /> Changes {status !== null && <span>{status.files.length}</span>}</button>
            <button className={mode === "history" ? "active" : ""} type="button" onClick={() => setMode("history")}><History size={14} /> History</button>
            {result !== null && <button className={mode === "activity" ? "active" : ""} type="button" onClick={() => setMode("activity")}><ArrowUp size={14} /> Activity</button>}
          </nav>}
          <div className="git-panel-header-actions">
            {phase === "editor" && mode === "changes" && <button className="secondary-button compact" type="button" onClick={() => { void loadStatus(); }} disabled={busy || statusLoading}><RefreshCw className={statusLoading ? "spin" : ""} size={14} /> Refresh</button>}
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close Git panel" disabled={busy}><X size={17} /></button>
          </div>
        </header>

        <div className="git-panel-content">
          {error !== null && <div className="git-error" role="alert"><AlertTriangle size={17} /><span>{error}</span><button type="button" aria-label="Dismiss Git error" onClick={() => setError(null)}><X size={14} /></button></div>}

          {phase === "editor" && mode === "changes" && <div className="git-changes-layout">
            <aside className="git-tree-pane" aria-label="Changed files">
              <div className="git-repository-strip"><span><b>{status?.branch ?? "Branch"}</b>{status?.remote ?? "No remote"}</span><code title={status?.repositoryRoot}>{status?.repositoryRoot ?? "Reading repository…"}</code></div>
              <label className="git-tree-search"><Search size={14} /><span className="sr-only">Search changed files</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search changed files" /></label>
              <div className="git-tree-scroll">
                {statusLoading && status === null ? <div className="git-tree-loading" aria-label="Reading staged and unstaged files">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div> : status !== null && <>
                  <FileTreeSection activePath={activePath} assignments={assignments} files={stagedFiles} label="Staged" onOpenFile={(path) => { void loadDiff(path); }} onTogglePaths={togglePaths} query={query} sectionId="staged" />
                  <FileTreeSection activePath={activePath} assignments={assignments} files={unstagedFiles} label="Unstaged" onOpenFile={(path) => { void loadDiff(path); }} onTogglePaths={togglePaths} query={query} sectionId="unstaged" />
                  {status.files.length === 0 && <div className="git-tree-clean"><Check size={20} /><strong>Working tree clean</strong><span>No staged or unstaged changes.</span></div>}
                </>}
              </div>
            </aside>

            <main className="git-diff-pane">
              <DiffViewer diff={activeDiff} error={diffError} loading={diffLoadingPath === activePath} path={activePath} />
              {selectedRisk !== null && <label className="git-risk git-active-risk"><input type="checkbox" checked={acknowledgedRisks.has(selectedRisk.path)} onChange={(event) => setAcknowledgedRisks((current) => { const next = new Set(current); if (event.target.checked) next.add(selectedRisk.path); else next.delete(selectedRisk.path); return next; })} /><ShieldAlert size={14} /><span><strong>Explicit review required.</strong> {selectedRisk.risks.map((risk) => risk.reason).join(" ")}</span></label>}
            </main>

            <aside className="git-commit-pane" aria-label="Commit plan">
              <div className="git-commit-pane-heading"><div><span className="eyebrow">Commit Plan</span><strong>{assignedPaths} selected</strong></div><button className="icon-button" type="button" onClick={addGroup} aria-label="Add separate commit"><Plus size={15} /></button></div>
              <div className="git-group-tabs" role="tablist" aria-label="Separate commits">{groups.map((group, index) => {
                const count = Object.values(assignments).filter((groupId) => groupId === group.id).length;
                return <button key={group.id} className={activeGroupId === group.id ? "active" : ""} type="button" role="tab" aria-selected={activeGroupId === group.id} onClick={() => setActiveGroupId(group.id)}><span>Commit {index + 1}</span><b>{count}</b></button>;
              })}</div>
              {activeGroup !== undefined && <div className="git-commit-form">
                <label><span>Summary</span><input value={activeGroup.message} maxLength={200} placeholder="Describe this focused change" onChange={(event) => { const message = event.target.value; setGroups((current) => current.map((group) => group.id === activeGroup.id ? { ...group, message, messageEdited: true } : group)); }} /></label>
                <label><span>Description <i>optional</i></span><textarea value={activeGroup.description} maxLength={4_798} rows={5} placeholder="Why this change is needed" onChange={(event) => { const description = event.target.value; setGroups((current) => current.map((group) => group.id === activeGroup.id ? { ...group, description } : group)); }} /></label>
                <div className="git-commit-summary"><span>{activeGroupPaths.length} {activeGroupPaths.length === 1 ? "file" : "files"}</span><span>{status === null ? "Choose files for this commit." : suggestionFor(status, activeGroupPaths).summary}</span></div>
                {groups.length > 1 && <button className="git-remove-commit" type="button" onClick={() => removeGroup(activeGroup.id)}><Trash2 size={13} /> Remove this commit</button>}
              </div>}
              <div className="git-commit-actions">
                <button className="secondary-button" type="button" onClick={() => { void pushBranch(); }} disabled={busy || !status?.canPush} title={status?.pushUnavailableReason ?? undefined}><ArrowUp size={14} /> {busy ? "Working…" : "Push"}</button>
                <button className="github-action-button" type="button" onClick={() => { void reviewPlan(); }} disabled={busy || statusLoading || assignedPaths === 0 || invalidCommit}><GitCommitHorizontal size={15} /> {busy ? "Reviewing…" : "Review Commit"}</button>
              </div>
            </aside>
          </div>}

          {phase === "editor" && mode === "history" && <div className="git-history-layout">
            <aside className="git-history-list" aria-label="Commit history">
              <header><div><span className="eyebrow">Commit History</span><strong>Select two to compare</strong></div><button className="icon-button" type="button" aria-label="Refresh commit history" onClick={() => { void loadHistory(true); }}><RefreshCw size={14} /></button></header>
              {historyLoading && <div className="git-history-loading"><LoaderCircle className="spin" size={18} /> Reading commits…</div>}
              {history?.length === 0 && <div className="git-history-empty"><History size={20} /><strong>No commits yet</strong><span>Create the first commit from Changes.</span></div>}
              {history?.map((commit) => {
                const marker = orderedComparison[0] === commit.hash ? "A" : orderedComparison[1] === commit.hash ? "B" : null;
                return <button key={commit.hash} className={`git-history-item${marker !== null ? " selected" : ""}`} type="button" aria-pressed={marker !== null} onClick={() => setHistorySelection((current) => current.includes(commit.hash) ? current.filter((hash) => hash !== commit.hash) : [...current.slice(-1), commit.hash])}><span className="git-history-rail"><i />{marker !== null && <b>{marker}</b>}</span><span className="git-history-copy"><strong>{commit.subject}</strong>{commit.body !== "" && <small>{commit.body}</small>}<span><code>{commit.hash.slice(0, 8)}</code>{commit.authorName}<time>{relativeCommitDate(commit.authoredAt)}</time></span></span></button>;
              })}
            </aside>
            <aside className="git-compare-tree" aria-label="Files changed between commits">
              <header><GitCompareArrows size={15} /><div><strong>{orderedComparison.length === 2 ? `${orderedComparison[0]?.slice(0, 7)} → ${orderedComparison[1]?.slice(0, 7)}` : "Choose two commits"}</strong><span>{comparison?.files.length ?? 0} changed files</span></div></header>
              {comparisonLoading && <div className="git-history-loading"><LoaderCircle className="spin" size={17} /> Comparing commits…</div>}
              {comparison !== null && <div className="git-tree-scroll"><FileTreeSection activePath={comparisonPath} files={comparison.files} label="Changed files" onOpenFile={(path) => { void loadComparisonDiff(path); }} query="" sectionId="comparison" /></div>}
            </aside>
            <main className="git-diff-pane"><DiffViewer diff={comparisonDiff} error={null} loading={comparisonDiffLoading} path={comparisonPath} /></main>
          </div>}

          {phase === "editor" && mode === "activity" && result !== null && <div className="git-activity-view"><div className={`git-result-summary ${result.success ? "success" : "failed"}`}>{result.success ? <Check size={19} /> : <AlertTriangle size={19} />}<div><strong>{result.success ? "Git workflow completed" : "Git workflow needs attention"}</strong><p>{result.commits.length > 0 ? `${result.commits.length} ${result.commits.length === 1 ? "commit" : "commits"} created` : "Push finished"}{result.push?.success ? " and remote updated" : ""}.</p></div></div><TerminalResult result={result} /></div>}

          {phase === "review" && prepared !== null && <div className="git-review"><button className="git-back-button" type="button" onClick={() => setPhase("editor")} disabled={busy}><ChevronLeft size={15} /> Edit selections</button><div className="git-review-warning"><ShieldAlert size={19} /><div><strong>Nothing outside this plan will be committed.</strong><p>Relay will re-check HEAD and each selected file before execution. A mismatch cancels the action.</p></div></div><div className="git-review-meta"><span>Branch <b>{prepared.branch ?? "detached HEAD"}</b></span><span>Remote <b>{prepared.remote ?? "none"}</b></span><span>Expires <b>{new Date(prepared.expiresAt).toLocaleTimeString()}</b></span></div><div className="git-review-commits">{prepared.commits.map((commit, index) => <article key={commit.id}><header><span><GitCommitHorizontal size={16} /> Commit {index + 1}</span><strong>{commit.message.split("\n")[0]}</strong></header><ul>{commit.files.map((file) => <li key={file.path}><code>{file.path}</code><span>+{file.additions} / -{file.deletions}</span></li>)}</ul><pre>{commit.commands.map((command) => `$ ${command}`).join("\n")}</pre></article>)}</div></div>}
        </div>

        {phase === "review" && <footer className="git-panel-footer"><p>Confirming may create multiple commits in the order shown.</p><div><button className="secondary-button" type="button" onClick={() => { void executePlan(false); }} disabled={busy}><GitCommitHorizontal size={15} /> {busy ? "Committing…" : "Commit"}</button><button className="github-action-button" type="button" onClick={() => { void executePlan(true); }} disabled={busy || !prepared?.canPush} title={prepared?.canPush ? undefined : status?.pushUnavailableReason ?? "Push unavailable"}><GitPullRequestArrow size={16} /> Commit &amp; Push</button></div></footer>}
      </section>
    </div>
  );
}

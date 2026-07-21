"use client";

import Image from "next/image";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  Box,
  BrainCircuit,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  Columns3,
  Copy,
  Edit3,
  ExternalLink,
  FileText,
  Filter,
  Folder,
  GitBranch,
  Github,
  HeartHandshake,
  History,
  LayoutDashboard,
  Lightbulb,
  Menu,
  Milestone,
  MoreHorizontal,
  Palette,
  Plus,
  Rows3,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  TestTube2,
  Trash2,
  Terminal,
  UserRound,
  X,
} from "lucide-react";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  chooseWorkspaceDirectory,
  copyTextToClipboard,
  defaultRelaySettings,
  getLocalStorageInfo,
  getServerWorkspaceSnapshot,
  getWorkspaceSnapshot,
  initializeWorkspaceStore,
  openDirectoryInTerminal,
  openDirectoryPath,
  openLocalStorageLocation,
  setWorkspace,
  subscribeWorkspace,
} from "../lib/storage";
import { SettingsModal as WorkspaceSettingsModal } from "./settings-modal";
import { UpdatePopup } from "./update-center";
import { GitCommitPanel } from "./git-commit-panel";
import { DiscoveryView } from "./discovery-view";
import {
  ConfirmDialog,
  ContextMenu,
  TextFieldModal,
  ToastShelf,
  type ContextMenuItem,
  type ToastMessage,
} from "./ui-primitives";
import type {
  BoardColumn,
  ContextRecord,
  Directory,
  RelayBoard,
  RelayCard,
  RelaySettings,
  RelayTag,
  RelayTagTone,
  RelayView,
  RelayWorkspaceData,
  ActivityRecord,
} from "../lib/types";

const views: Array<{
  id: RelayView;
  label: string;
  icon: typeof Columns3;
}> = [
  { id: "board", label: "Board", icon: Columns3 },
  { id: "plan", label: "Plan", icon: FileText },
  { id: "timeline", label: "Timeline", icon: Milestone },
  { id: "context", label: "Context", icon: BrainCircuit },
  { id: "decisions", label: "Decisions", icon: Lightbulb },
  { id: "discovery", label: "Discovery", icon: Search },
  { id: "activity", label: "Activity", icon: History },
];

const typeIcons: Record<RelayCard["type"], typeof Box> = {
  bug: Bug,
  decision: Lightbulb,
  feature: Sparkles,
  research: BrainCircuit,
  security: ShieldCheck,
  task: Box,
  test: TestTube2,
};

const cardTypes = Object.keys(typeIcons) as RelayCard["type"][];
const priorities: RelayCard["priority"][] = ["low", "normal", "high", "urgent", "critical"];

const defaultColumns: BoardColumn[] = [
  { id: "backlog", name: "Backlog", tone: "gray" },
  { id: "ready", name: "Ready", tone: "violet" },
  { id: "progress", name: "In Progress", tone: "blue" },
  { id: "review", name: "Needs Review", tone: "orange" },
  { id: "verified", name: "Verified", tone: "green" },
];

const columnTones: BoardColumn["tone"][] = ["gray", "violet", "blue", "orange", "green", "coral"];
const tagTones: RelayTagTone[] = ["blue", "green", "orange", "violet", "coral", "gray"];
const localActor = defaultRelaySettings.displayName;

function cx(...classes: Array<false | null | string | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function now(): string {
  return new Date().toISOString();
}

function activeTaskCount(cards: RelayCard[]): number {
  return cards.filter((card) => card.archivedAt === undefined && card.columnId !== "verified").length;
}

function blockerCount(cards: RelayCard[]): number {
  return cards.filter((card) => card.archivedAt === undefined && card.blocked).length;
}

function cardArchivedCleared(update: Partial<RelayCard>): boolean {
  return Object.prototype.hasOwnProperty.call(update, "archivedAt") && update.archivedAt === undefined;
}

function formatRecordedTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function agentLabel(activity: ActivityRecord): string {
  if (activity.actorKind === "claude") return "Claude";
  if (activity.actorKind === "codex") return "Codex";
  if (activity.actorKind === "agent") return activity.actor.trim() || "Agent";

  const actor = activity.actor.trim();
  const normalized = actor.toLowerCase();
  if (normalized.includes("claude")) return "Claude";
  if (normalized.includes("codex") || normalized.includes("gpt") || normalized.includes("openai")) return "Codex";
  return actor || localActor;
}

function agentKind(activity: ActivityRecord): NonNullable<ActivityRecord["actorKind"]> {
  if (activity.actorKind !== undefined) return activity.actorKind;
  const label = agentLabel(activity).toLowerCase();
  if (label.includes("claude")) return "claude";
  if (label.includes("codex") || label.includes("gpt") || label.includes("openai")) return "codex";
  return "human";
}

function ActivityAvatar({ activity }: { activity: ActivityRecord }) {
  const kind = agentKind(activity);
  const isCodex = kind === "codex" || kind === "agent";
  const image = kind === "claude" ? "/claude.png" : undefined;

  return (
    <span className={cx("activity-actor-icon", kind)} aria-hidden="true">
      {isCodex ? (
        <>
          <Image className="theme-icon-light" src="/openai.png" alt="" width={22} height={22} />
          <Image className="theme-icon-dark" src="/openai-dark.png" alt="" width={22} height={22} />
        </>
      ) : image === undefined ? (
        <UserRound size={12} />
      ) : (
        <Image src={image} alt="" width={22} height={22} />
      )}
    </span>
  );
}

function ActivityLine({ activity, className }: { activity: ActivityRecord; className?: string }) {
  return (
    <div className={cx("activity-line", className)}>
      <span className={`activity-dot ${activity.tone}`} />
      <ActivityAvatar activity={activity} />
      <div className="activity-line-copy">
        <p><strong className={cx(agentKind(activity) !== "human" && "agent")}>{agentLabel(activity)}</strong> {activity.action} <b>{activity.target}</b></p>
        <span>{formatRecordedTime(activity.time)}</span>
      </div>
    </div>
  );
}

function cleanTag(value: string): string {
  return value.trim().replace(/^#/, "").replace(/\s+/g, "-").slice(0, 32);
}

function tagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

function tagTone(tag: string, registry: RelayTag[]): RelayTagTone {
  const sharedTag = registry.find((item) => tagKey(item.name) === tagKey(tag));
  if (sharedTag !== undefined) return sharedTag.tone;
  let hash = 0;
  for (const character of tagKey(tag)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return tagTones[hash % tagTones.length] ?? "gray";
}

function nextTagTone(tone: RelayTagTone): RelayTagTone {
  const index = tagTones.indexOf(tone);
  return tagTones[(index + 1) % tagTones.length] ?? "blue";
}

function TagPill({
  tag,
  registry,
  selected = false,
  removable = false,
  onClick,
  onRemove,
  onCycleTone,
}: {
  tag: string;
  registry: RelayTag[];
  selected?: boolean;
  removable?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  onCycleTone?: () => void;
}) {
  const tone = tagTone(tag, registry);
  return (
    <span className={cx("tag-pill", `tone-${tone}`, selected && "selected")}>
      <button className="tag-pill-main" type="button" onClick={onClick ?? onRemove} aria-label={removable ? `Remove ${tag} tag` : `Use ${tag} tag`}>
        <Tag size={10} />
        <span>{tag}</span>
      </button>
      {onCycleTone !== undefined && (
        <button className="tag-tone-button" type="button" onClick={onCycleTone} aria-label={`Change ${tag} color`}>
          <Palette size={10} />
        </button>
      )}
      {removable && onRemove !== undefined && (
        <button className="tag-remove-button" type="button" onClick={onRemove} aria-label={`Remove ${tag} tag`}>
          <X size={10} />
        </button>
      )}
    </span>
  );
}

function TagEditor({
  tags,
  registry,
  onChange,
  onCycleTone,
}: {
  tags: string[];
  registry: RelayTag[];
  onChange: (tags: string[]) => void;
  onCycleTone: (tag: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const selectedKeys = useMemo(() => new Set(tags.map(tagKey)), [tags]);
  const suggestions = useMemo(() => {
    const needle = tagKey(draft);
    return registry
      .filter((tag) => !selectedKeys.has(tagKey(tag.name)))
      .filter((tag) => needle === "" || tagKey(tag.name).includes(needle))
      .slice(0, 8);
  }, [draft, registry, selectedKeys]);

  function addDraftTag(value = draft) {
    const tag = cleanTag(value);
    if (tag === "") return;
    const nextTags = [...tags];
    if (!nextTags.some((item) => tagKey(item) === tagKey(tag))) nextTags.push(tag);
    onChange(nextTags.slice(0, 12));
    setDraft("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter((item) => tagKey(item) !== tagKey(tag)));
  }

  return (
    <div className="tag-editor">
      <div className="tag-editor-chips" aria-label="Card tags">
        {tags.map((tag) => (
          <TagPill key={tag} tag={tag} registry={registry} removable onRemove={() => removeTag(tag)} onCycleTone={() => onCycleTone(tag)} />
        ))}
        <input
          value={draft}
          onBlur={() => addDraftTag()}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "," || event.key === "Tab") {
              if (draft.trim() === "") return;
              event.preventDefault();
              addDraftTag();
            }
            if (event.key === "Backspace" && draft === "" && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          placeholder={tags.length === 0 ? "Add tag" : "Add another"}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="tag-suggestions" aria-label="Shared tags">
          {suggestions.map((tag) => (
            <TagPill key={tag.name} tag={tag.name} registry={registry} onClick={() => addDraftTag(tag.name)} onCycleTone={() => onCycleTone(tag.name)} />
          ))}
        </div>
      )}
      <p>Enter adds a tag. Shared tags reuse the same color everywhere.</p>
    </div>
  );
}

function LogoMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

function ProgressRing({ value }: { value: number }) {
  const progress = Math.max(0, Math.min(100, Number.isFinite(value) ? Math.round(value) : 0));
  return (
    <span
      className="progress-ring"
      style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}
      aria-label={`${progress}% estimated progress`}
    >
      <span>{progress}</span>
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "R";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "R";
}

function UserMenu({
  settings,
  storagePath,
  onOpenSettings,
  onOpenStorage,
}: {
  settings: RelaySettings;
  storagePath: string | null;
  onOpenSettings: () => void;
  onOpenStorage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const displayName = settings.displayName.trim() || localActor;

  return (
    <div className="user-menu">
      <button
        className="user-preview"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="user-avatar">{initials(displayName)}</span>
        <span>
          <strong>{displayName}</strong>
          <small>Local Workspace</small>
        </span>
      </button>
      {open && (
        <div className="user-dropup" role="menu">
          <div className="user-dropup-summary">
            <span className="user-avatar">{initials(displayName)}</span>
            <div>
              <strong>{displayName}</strong>
              <small title={storagePath ?? undefined}>Stored on this device</small>
            </div>
          </div>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onOpenSettings(); }}>
            <Settings size={15} /> Settings
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onOpenStorage(); }} disabled={storagePath === null}>
            <ExternalLink size={15} /> Open Storage File
          </button>
        </div>
      )}
    </div>
  );
}

function BoardCard({
  board,
  onArchive,
  onDelete,
  onGit,
  onOpen,
  onRename,
}: {
  board: RelayBoard;
  onArchive: () => void;
  onDelete: () => void;
  onGit: () => void;
  onOpen: () => void;
  onRename: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const archived = board.archivedAt !== undefined;

  return (
    <article className={cx("board-summary", archived && "archived")}>
      <button className="board-summary-main" type="button" onClick={onOpen}>
        <div className="board-summary-top">
          <div className="board-icon">
            <Code2 size={18} />
          </div>
        </div>
        <div className="board-summary-copy">
          <span className="eyebrow">{board.currentPhase}</span>
          <h3>{board.name}</h3>
          <p>{board.description}</p>
        </div>
        <div className="board-summary-stats">
          <ProgressRing value={board.progress} />
          <div>
            <strong>{board.activeTasks}</strong>
            <span>active tasks</span>
          </div>
          <div>
            <strong className={board.blockers > 0 ? "danger-text" : undefined}>{board.blockers}</strong>
            <span>blockers</span>
          </div>
        </div>
        <div className="board-summary-footer">
          <span><GitBranch size={13} /> {board.repository}</span>
          <span><Clock3 size={13} /> {formatRecordedTime(board.lastActivity)}</span>
        </div>
      </button>
      <div className="board-summary-actions">
        <button className="board-github-button" type="button" aria-label={`Open Git workflow for ${board.name}`} onClick={onGit}><Github size={15} /> Git</button>
        <button className="card-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`Actions for ${board.name}`} onClick={() => setMenuOpen((open) => !open)}>
          <MoreHorizontal size={17} />
        </button>
        {menuOpen && (
          <div className="floating-action-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpen(); }}><ExternalLink size={14} /> Open board</button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onRename(); }}><Edit3 size={14} /> Rename Board</button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onArchive(); }}><Archive size={14} /> {archived ? "Restore Board" : "Archive Board"}</button>
            <button className="danger" type="button" role="menuitem" onClick={() => { setMenuOpen(false); onDelete(); }}><Trash2 size={14} /> Delete Board</button>
          </div>
        )}
      </div>
    </article>
  );
}

interface CreateBoardModalProps {
  directories: RelayWorkspaceData["directories"];
  onClose: () => void;
  onCreate: (input: { name: string; description: string; directoryId: string; directoryName: string; directoryPath?: string; plan: string }) => void;
}

function CreateBoardModal({ directories, onClose, onCreate }: CreateBoardModalProps) {
  const titleId = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [plan, setPlan] = useState("");
  const [directoryId, setDirectoryId] = useState(directories[0]?.id ?? "");
  const [directoryName, setDirectoryName] = useState("");
  const [directoryPath, setDirectoryPath] = useState<string | undefined>();
  const [mode, setMode] = useState<"blank" | "plan">("blank");
  const directoryReady = directoryId !== "" || directoryPath !== undefined;

  async function pickDirectory() {
    const selection = await chooseWorkspaceDirectory();
    if (selection === null) return;
    setDirectoryId("");
    setDirectoryName(selection.name);
    setDirectoryPath(selection.path);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal create-board-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">New Progress Board</span>
            <h2 id={titleId}>Create a place for the work</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="creation-modes" aria-label="Board creation source">
          <button className={cx(mode === "blank" && "active")} type="button" onClick={() => setMode("blank")}>
            <Plus size={17} /> Blank Board
          </button>
          <button className={cx(mode === "plan" && "active")} type="button" onClick={() => setMode("plan")}>
            <FileText size={17} /> Pasted Plan
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() === "" || !directoryReady) return;
            const input = { name: name.trim(), description: description.trim(), directoryId, directoryName: directoryName.trim(), plan };
            onCreate(directoryPath === undefined ? input : { ...input, directoryPath });
          }}
        >
          <label>
            Board Name
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required placeholder="e.g. Billing migration" />
          </label>
          <div className="form-grid">
            <label>
              Directory
              {directories.length > 0 ? (
                <div className="directory-picker-row">
                  <select value={directoryId} onChange={(event) => { setDirectoryId(event.target.value); setDirectoryName(""); setDirectoryPath(undefined); }}>
                    {directoryPath !== undefined && <option value="">{directoryName}</option>}
                    {directories.map((directory) => <option key={directory.id} value={directory.id}>{directory.name}</option>)}
                  </select>
                  <button className="secondary-button" type="button" onClick={() => { void pickDirectory(); }}><Folder size={15} /> Choose</button>
                </div>
              ) : (
                <button className="directory-picker-empty" type="button" onClick={() => { void pickDirectory(); }}>
                  <Folder size={17} />
                  <span>{directoryPath === undefined ? "Choose a project directory" : directoryName}</span>
                </button>
              )}
              {directoryPath !== undefined && <small className="picked-directory-path">{directoryPath}</small>}
            </label>
            <label>
              Short Description
              <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={600} placeholder="What outcome does this board own?" />
            </label>
          </div>
          {mode === "plan" && (
            <label>
              Detailed Plan
              <textarea className="plan-paste" value={plan} onChange={(event) => setPlan(event.target.value)} placeholder="Paste the complete project request, constraints, and acceptance criteria..." />
            </label>
          )}
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
            <button className="primary-button" type="submit" disabled={name.trim() === "" || !directoryReady}>
              <CircleDot size={17} /> Create Board
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function DonateModal({ onClose }: { onClose: () => void }) {
  const titleId = useId();

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal donate-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">Support Relay</span>
            <h2 id={titleId}>Help fund team sharing</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="donate-copy">
          <HeartHandshake size={24} />
          <p>
            Relay is open source and local-first right now. I want to build a proper database-backed version so people can share boards with teams, track progress together, and keep the same evidence trail across devices.
          </p>
          <p>
            I do not currently have the funds to build and run that infrastructure. Donations help pay for the database, sync, and collaboration work.
          </p>
        </div>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Not Now</button>
          <a className="primary-button" href="https://venmo.com/u/jacobpowaza" target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> Donate with Venmo
          </a>
        </div>
      </section>
    </div>
  );
}

function Dashboard({
  data,
  directoryId,
  settings,
  search,
  storagePath,
  onOpenStorage,
  onOpenBoard,
  onArchiveBoard,
  onDeleteBoard,
  onGitBoard,
  onRenameBoard,
  onCreateBoard,
  onOpenDiscovery,
}: {
  data: RelayWorkspaceData;
  directoryId: string;
  settings: RelaySettings;
  search: string;
  storagePath: string | null;
  onOpenStorage: () => void;
  onOpenBoard: (boardId: string) => void;
  onArchiveBoard: (boardId: string) => void;
  onDeleteBoard: (boardId: string) => void;
  onGitBoard: (boardId: string) => void;
  onRenameBoard: (boardId: string) => void;
  onCreateBoard: () => void;
  onOpenDiscovery: () => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const normalizedSearch = search.trim().toLowerCase();
  const boards = useMemo(
    () => data.boards.filter((board) => {
      if (!showArchived && board.archivedAt !== undefined) return false;
      const inDirectory = directoryId === "all" || board.directoryId === directoryId;
      const matches = normalizedSearch === "" || `${board.name} ${board.description} ${board.repository}`.toLowerCase().includes(normalizedSearch);
      return inDirectory && matches;
    }),
    [data.boards, directoryId, normalizedSearch, showArchived],
  );
  const activeBoards = boards.filter((board) => board.archivedAt === undefined);
  const archivedCount = data.boards.filter((board) => board.archivedAt !== undefined).length;
  const nextBoard = activeBoards.find((board) => board.blockers === 0) ?? activeBoards[0];
  const recentActivity = useMemo(
    () => data.boards
      .flatMap((board) => board.activity)
      .sort((left, right) => right.time.localeCompare(left.time))
      .slice(0, settings.activityLimit),
    [data.boards, settings.activityLimit],
  );

  return (
    <main className="dashboard-content">
      <section className="dashboard-hero reveal">
        <div>
          <span className="eyebrow">Local Workspace</span>
          <h1>Development work that remembers</h1>
          <p>Plans, evidence, and context stay attached to the project, not trapped in yesterday&apos;s session.</p>
        </div>
        {directoryId !== "all" && (() => {
          const dir = data.directories.find((item) => item.id === directoryId);
          const dirPath = dir?.path;
          const hasDiscovery = dirPath !== undefined && data.discoveries?.[dirPath] !== undefined;
          const discovery = dirPath !== undefined ? data.discoveries?.[dirPath] : undefined;
          return (
            <button className="continue-card" type="button" onClick={onOpenDiscovery} disabled={!dirPath}>
              <div className="continue-signal"><Search size={19} /></div>
              <div>
                <span className="eyebrow">Codebase Intelligence</span>
                <strong>Project Discovery</strong>
                {hasDiscovery && discovery ? (
                  <p>{discovery.discoveryCount} files indexed · {discovery.features.length} features · Updated {formatRecordedTime(discovery.lastFullDiscovery ?? "")}</p>
                ) : (
                  <p>Scan this directory to build a codebase intelligence index</p>
                )}
              </div>
              <ArrowRight size={20} />
            </button>
          );
        })()}
        {directoryId === "all" && nextBoard !== undefined && (
          <button className="continue-card" type="button" onClick={() => onOpenBoard(nextBoard.id)}>
            <div className="continue-signal"><Clock3 size={19} /></div>
            <div>
              <span className="eyebrow">Pick up where you left off</span>
              <strong>{nextBoard.name}</strong>
              <p>{nextBoard.activeTasks} active tasks · {nextBoard.currentPhase} · Updated {formatRecordedTime(nextBoard.lastActivity)}</p>
            </div>
            <ArrowRight size={20} />
          </button>
        )}
      </section>

      <section className="section-block reveal delay-1">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Workspace</span>
            <h2>{directoryId === "all" ? "All progress boards" : data.directories.find((item) => item.id === directoryId)?.name}</h2>
          </div>
          <div className="section-actions">
            {archivedCount > 0 && (
              <button className={cx("secondary-button compact", showArchived && "active")} type="button" onClick={() => setShowArchived((current) => !current)}>
                <Archive size={15} /> {showArchived ? "Hide Archived" : `Show Archived (${archivedCount})`}
              </button>
            )}
            <button className="primary-button compact" type="button" onClick={onCreateBoard}><Plus size={16} /> New Board</button>
          </div>
        </div>
        <div className="board-grid">
          <button className="new-board-card" type="button" onClick={onCreateBoard}>
            <span><Plus size={26} /></span>
            <strong>Create Progress Board</strong>
            <p>Start blank or bring an existing plan</p>
          </button>
          {boards.map((board) => <BoardCard key={board.id} board={board} onArchive={() => onArchiveBoard(board.id)} onDelete={() => onDeleteBoard(board.id)} onGit={() => onGitBoard(board.id)} onOpen={() => onOpenBoard(board.id)} onRename={() => onRenameBoard(board.id)} />)}
        </div>
        {boards.length === 0 && data.boards.length === 0 && (
          <div className="empty-state">
            <Folder size={24} />
            <h3>No local projects yet</h3>
            <p>Create a board to start storing project data on this device.</p>
          </div>
        )}
        {boards.length === 0 && data.boards.length > 0 && (
          <div className="empty-state"><Search size={24} /><h3>No matching boards</h3><p>Change the directory or search phrase.</p></div>
        )}
      </section>

      <section className="dashboard-bottom reveal delay-2">
        <div className="activity-preview panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Recent Activity</span><h2>Latest Changes</h2></div>
          </div>
          {recentActivity.map((item) => (
            <ActivityLine activity={item} className="activity-row" key={item.id} />
          ))}
          {recentActivity.length === 0 && <p className="panel-empty">Activity appears here after you create or update work.</p>}
        </div>
        <div className="agents-panel panel">
          <div className="panel-heading"><div><span className="eyebrow">On This Device</span><h2>Local Data</h2></div></div>
          <div className="local-data-stat"><Folder size={18} /><div><strong>{data.directories.length}</strong><p>{data.directories.length === 1 ? "directory" : "directories"}</p></div></div>
          <div className="local-data-stat"><Columns3 size={18} /><div><strong>{data.boards.length}</strong><p>{data.boards.length === 1 ? "progress board" : "progress boards"}</p></div></div>
          {settings.showStoragePath && storagePath !== null && <p className="storage-path" title={storagePath}>Storage File: {storagePath}</p>}
          <button className="secondary-button storage-open-button" type="button" onClick={onOpenStorage}><ExternalLink size={14} /> Open Storage File</button>
        </div>
      </section>
    </main>
  );
}

function CardTile({
  card,
  columns,
  groupName,
  tagRegistry,
  onMove,
  onOpen,
  onDelete,
  onDuplicate,
  onArchive,
  onToggleBlocked,
}: {
  card: RelayCard;
  columns: BoardColumn[];
  groupName: string;
  tagRegistry: RelayTag[];
  onMove: (columnId: string) => void;
  onOpen: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onToggleBlocked: () => void;
}) {
  const TypeIcon = typeIcons[card.type];
  const columnIndex = columns.findIndex((column) => column.id === card.columnId);
  const notes = card.notes ?? [];
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  return (
    <article
      className={cx("task-card", card.blocked && "blocked", card.archivedAt !== undefined && "archived", dragging && "dragging")}
      draggable
      onDragStart={(event) => {
        setDragging(true);
        event.dataTransfer.setData("text/relay-card", card.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => setDragging(false)}
    >
      <button className="task-card-main" type="button" onClick={onOpen}>
        <div className="task-card-meta">
          <span className={`type-chip ${card.type}`}><TypeIcon size={12} /> {card.type.replace("_", " ")}</span>
          <span className={`priority-dot ${card.priority}`} aria-label={`${card.priority} priority`} />
        </div>
        <h3>{card.title}</h3>
        <p>{card.description}</p>
        <div className="tag-list">
          <span><Milestone size={10} /> {groupName}</span>
          {(card.tags ?? []).map((tag) => <span className={`card-tag tone-${tagTone(tag, tagRegistry)}`} key={tag}><Tag size={10} /> {tag}</span>)}
        </div>
        <div className="task-progress"><span style={{ width: `${card.progress}%` }} /></div>
        <div className="task-footer">
          <span><UserRound size={13} />{card.owner}</span>
          <span><FileText size={13} /> {notes.length}</span>
          <span><CheckCircle2 size={13} /> {card.criteriaDone}/{card.criteriaTotal}</span>
        </div>
      </button>
      <div className="task-card-actions">
        <button className="card-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`Actions for ${card.title}`} onClick={() => setMenuOpen((open) => !open)}>
          <MoreHorizontal size={15} />
        </button>
        {menuOpen && (
          <div className="floating-action-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpen(); }}><Edit3 size={14} /> Edit Card</button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onDuplicate(); }}><Copy size={14} /> Duplicate Card</button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onArchive(); }}><Archive size={14} /> {card.archivedAt === undefined ? "Archive Card" : "Restore Card"}</button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onToggleBlocked(); }}><AlertTriangle size={14} /> {card.blocked ? "Clear Blocker" : "Mark Blocked"}</button>
            <button className="danger" type="button" role="menuitem" onClick={() => { setMenuOpen(false); onDelete(); }}><Trash2 size={14} /> Delete Card</button>
          </div>
        )}
      </div>
      <div className="card-move-controls" aria-label={`Move ${card.title}`}>
        <button type="button" disabled={columnIndex <= 0} onClick={() => {
          const previous = columns[columnIndex - 1];
          if (previous !== undefined) onMove(previous.id);
        }} aria-label="Move left"><ArrowLeft size={13} /></button>
        <button type="button" disabled={columnIndex >= columns.length - 1} onClick={() => {
          const next = columns[columnIndex + 1];
          if (next !== undefined) onMove(next.id);
        }} aria-label="Move right"><ArrowRight size={13} /></button>
      </div>
    </article>
  );
}

function BoardView({
  board,
  settings,
  tagRegistry,
  onMoveCard,
  onDeleteCard,
  onDuplicateCard,
  onArchiveCard,
  onToggleCardBlocked,
  onAddCard,
  onAddGroup,
  onAddColumn,
  onDeleteColumn,
  onRenameColumn,
  onReorderColumn,
  onReorderGroups,
  onCycleTagTone,
  onOpenCard,
}: {
  board: RelayBoard;
  settings: RelaySettings;
  tagRegistry: RelayTag[];
  onMoveCard: (cardId: string, columnId: string, phaseId?: string) => void;
  onDeleteCard: (cardId: string) => void;
  onDuplicateCard: (cardId: string) => void;
  onArchiveCard: (cardId: string) => void;
  onToggleCardBlocked: (cardId: string) => void;
  onAddCard: (columnId: string, phaseId: string, title: string) => void;
  onAddGroup: (name: string) => void;
  onAddColumn: (name: string) => void;
  onDeleteColumn: (columnId: string) => void;
  onRenameColumn: (columnId: string, name: string) => void;
  onReorderColumn: (columnId: string, direction: -1 | 1) => void;
  onReorderGroups: (phaseId: string, targetPhaseId: string) => void;
  onCycleTagTone: (tag: string) => void;
  onOpenCard: (cardId: string) => void;
}) {
  const [addingTo, setAddingTo] = useState<{ columnId: string; phaseId: string } | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newColumnName, setNewColumnName] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const [addingColumn, setAddingColumn] = useState(false);
  const [newHolderOpen, setNewHolderOpen] = useState(false);
  const [showArchivedCards, setShowArchivedCards] = useState(false);
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingColumnName, setEditingColumnName] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [filters, setFilters] = useState<{
    tag: string;
    priority: RelayCard["priority"] | "all";
    type: RelayCard["type"] | "all";
    blockedOnly: boolean;
  }>({ tag: "all", priority: "all", type: "all", blockedOnly: false });
  const baseGroups = useMemo(
    () => board.phases.length > 0 ? board.phases : [{ id: "unphased", name: "Ungrouped", objective: "", progress: 0, status: "in_progress" as const }],
    [board.phases],
  );
  const knownGroupIds = useMemo(() => new Set(baseGroups.map((group) => group.id)), [baseGroups]);
  const groups = useMemo(
    () => board.cards.some((card) => !knownGroupIds.has(card.phaseId)) && !knownGroupIds.has("unphased")
      ? [...baseGroups, { id: "unphased", name: "Ungrouped", objective: "", progress: 0, status: "planned" as const }]
      : baseGroups,
    [baseGroups, board.cards, knownGroupIds],
  );
  const tagOptions = useMemo(() => tagRegistry.filter((tag) => board.cards.some((card) => (card.tags ?? []).some((item) => tagKey(item) === tagKey(tag.name)))), [board.cards, tagRegistry]);
  const archivedCardCount = board.cards.filter((card) => card.archivedAt !== undefined).length;
  const activeFilterCount = (filters.tag === "all" ? 0 : 1) + (filters.priority === "all" ? 0 : 1) + (filters.type === "all" ? 0 : 1) + (filters.blockedOnly ? 1 : 0) + (showArchivedCards ? 1 : 0);
  const filteredCards = useMemo(() => board.cards.filter((card) => {
    if (!showArchivedCards && card.archivedAt !== undefined) return false;
    if (filters.tag !== "all" && !(card.tags ?? []).some((tag) => tagKey(tag) === tagKey(filters.tag))) return false;
    if (filters.priority !== "all" && card.priority !== filters.priority) return false;
    if (filters.type !== "all" && card.type !== filters.type) return false;
    if (filters.blockedOnly && !card.blocked) return false;
    return true;
  }), [board.cards, filters, showArchivedCards]);
  const cardsByColumn = useMemo(() => {
    const map = new Map<string, RelayCard[]>();
    for (const column of board.columns) map.set(column.id, []);
    for (const card of filteredCards) {
      const cards = map.get(card.columnId);
      if (cards === undefined) map.set(card.columnId, [card]);
      else cards.push(card);
    }
    return map;
  }, [filteredCards, board.columns]);
  const cardsByColumnAndGroup = useMemo(() => {
    const map = new Map<string, RelayCard[]>();
    for (const card of filteredCards) {
      const groupId = knownGroupIds.has(card.phaseId) ? card.phaseId : "unphased";
      const key = `${card.columnId}:${groupId}`;
      const cards = map.get(key);
      if (cards === undefined) map.set(key, [card]);
      else cards.push(card);
    }
    return map;
  }, [filteredCards, knownGroupIds]);

  const statusColumnWidth = Math.max(280, Math.min(320, settings.boardColumnWidth + 40));
  const newHolderWidth = 176;
  const boardMinWidth = `${Math.max(
    960,
    board.columns.length * statusColumnWidth + newHolderWidth + board.columns.length * 8 + 24,
  )}px`;

  return (
    <div className="kanban-scroll" style={{ "--board-min-width": boardMinWidth } as React.CSSProperties} onDragEndCapture={() => {
      setDraggingGroupId(null);
      setDragOverGroupId(null);
    }}>
      <div className="board-edit-toolbar">
        <div className="board-toolbar-label"><Rows3 size={15} /><span>{groups.length} groups</span></div>
        <div className="board-toolbar-actions">
          {addingGroup ? (
            <form className="inline-add-form" onSubmit={(event) => {
              event.preventDefault();
              if (newGroupName.trim() === "") return;
              onAddGroup(newGroupName.trim());
              setNewGroupName("");
              setAddingGroup(false);
            }}>
              <Milestone size={14} />
              <input autoFocus value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="Group name" maxLength={80} />
              <button type="submit" disabled={newGroupName.trim() === ""} aria-label="Create group"><Check size={14} /></button>
              <button type="button" onClick={() => { setAddingGroup(false); setNewGroupName(""); }} aria-label="Cancel group"><X size={14} /></button>
            </form>
          ) : (
            <button className="toolbar-add-button" type="button" onClick={() => setAddingGroup(true)} aria-label="Add group"><Plus size={15} /><span>Group</span></button>
          )}
          {addingColumn ? (
            <form className="inline-add-form" onSubmit={(event) => {
              event.preventDefault();
              if (newColumnName.trim() === "") return;
              onAddColumn(newColumnName.trim());
              setNewColumnName("");
              setAddingColumn(false);
            }}>
              <Columns3 size={14} />
              <input autoFocus value={newColumnName} onChange={(event) => setNewColumnName(event.target.value)} placeholder="Holder name" maxLength={60} />
              <button type="submit" disabled={newColumnName.trim() === ""} aria-label="Create holder"><Check size={14} /></button>
              <button type="button" onClick={() => { setAddingColumn(false); setNewColumnName(""); }} aria-label="Cancel holder"><X size={14} /></button>
            </form>
          ) : (
            <button className="toolbar-add-button holder" type="button" onClick={() => setAddingColumn(true)} aria-label="Add holder"><Plus size={15} /><span>Holder</span></button>
          )}
        </div>
      </div>
      <div className="board-filter-bar" aria-label="Board filters">
        <span><Filter size={13} /> Filters</span>
        <div className="filter-tags">
          <button className={cx("filter-chip", filters.tag === "all" && "selected")} type="button" onClick={() => setFilters((current) => ({ ...current, tag: "all" }))}>All tags</button>
          {tagOptions.map((tag) => (
            <TagPill
              key={tag.name}
              tag={tag.name}
              registry={tagRegistry}
              selected={filters.tag !== "all" && tagKey(filters.tag) === tagKey(tag.name)}
              onClick={() => setFilters((current) => ({ ...current, tag: current.tag !== "all" && tagKey(current.tag) === tagKey(tag.name) ? "all" : tag.name }))}
              onCycleTone={() => onCycleTagTone(tag.name)}
            />
          ))}
        </div>
        <select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value as typeof filters.type }))} aria-label="Filter by type">
          <option value="all">All Types</option>
          {cardTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select value={filters.priority} onChange={(event) => setFilters((current) => ({ ...current, priority: event.target.value as typeof filters.priority }))} aria-label="Filter by priority">
          <option value="all">All Priorities</option>
          {priorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
        </select>
        <button className={cx("filter-chip", filters.blockedOnly && "selected")} type="button" onClick={() => setFilters((current) => ({ ...current, blockedOnly: !current.blockedOnly }))}><AlertTriangle size={12} /> Blocked</button>
        {archivedCardCount > 0 && <button className={cx("filter-chip", showArchivedCards && "selected")} type="button" onClick={() => setShowArchivedCards((current) => !current)}><Archive size={12} /> Archived</button>}
        <strong>{filteredCards.length}/{board.cards.length}</strong>
        {activeFilterCount > 0 && <button className="clear-filters" type="button" onClick={() => { setFilters({ tag: "all", priority: "all", type: "all", blockedOnly: false }); setShowArchivedCards(false); }}>Clear</button>}
      </div>
      <div
        className="kanban-board"
        style={{
          "--status-column-count": board.columns.length,
          "--status-column-width": `${statusColumnWidth}px`,
          "--new-holder-width": `${newHolderWidth}px`,
        } as React.CSSProperties}
      >
        {board.columns.map((column, columnIndex) => {
          const cards = cardsByColumn.get(column.id) ?? [];
          return (
            <section
              className="kanban-lane"
              key={column.id}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("text/relay-card")) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const cardId = event.dataTransfer.getData("text/relay-card");
                if (cardId !== "") onMoveCard(cardId, column.id);
              }}
            >
              <header className="kanban-lane-header">
                <div>
                  <span className={`column-dot ${column.tone}`} />
                  {editingColumnId === column.id ? (
                    <form className="column-name-form" onSubmit={(event) => {
                      event.preventDefault();
                      if (editingColumnName.trim() !== "") onRenameColumn(column.id, editingColumnName.trim());
                      setEditingColumnId(null);
                    }}>
                      <input autoFocus value={editingColumnName} onChange={(event) => setEditingColumnName(event.target.value)} onBlur={() => {
                        if (editingColumnName.trim() !== "") onRenameColumn(column.id, editingColumnName.trim());
                        setEditingColumnId(null);
                      }} maxLength={60} aria-label={`Rename ${column.name}`} />
                    </form>
                  ) : (
                    <button className="column-name-button" type="button" onClick={() => {
                      setEditingColumnId(column.id);
                      setEditingColumnName(column.name);
                    }} aria-label={`Rename ${column.name}`}><h2>{column.name}</h2></button>
                  )}
                  <b>{cards.length}</b>
                </div>
                <div className="column-actions">
                  <button type="button" onClick={() => setAddingGroup(true)} aria-label="Add group"><Plus size={11} /></button>
                  <button type="button" disabled={columnIndex <= 0} onClick={() => onReorderColumn(column.id, -1)} aria-label={`Move ${column.name} Left`}><ArrowLeft size={11} /></button>
                  <button type="button" disabled={columnIndex >= board.columns.length - 1} onClick={() => onReorderColumn(column.id, 1)} aria-label={`Move ${column.name} Right`}><ArrowRight size={11} /></button>
                  <button type="button" disabled={board.columns.length <= 1} onClick={() => onDeleteColumn(column.id)} aria-label={`Delete ${column.name}`}><Trash2 size={11} /></button>
                </div>
              </header>
              <div className="kanban-lane-groups">
                {groups.map((group, groupIndex) => {
                  const canReorder = board.phases.some((phase) => phase.id === group.id);
                  const groupedCards = cardsByColumnAndGroup.get(`${column.id}:${group.id}`) ?? [];
                  return (
                    <section
                      className={cx("card-group", draggingGroupId === group.id && "dragging", dragOverGroupId === group.id && "drop-target")}
                      key={`${column.id}:${group.id}`}
                      draggable={canReorder}
                      onDragStart={(event) => {
                        if (!canReorder) return;
                        setDraggingGroupId(group.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/relay-group", group.id);
                      }}
                      onDragEnd={() => setDraggingGroupId(null)}
                      onDragOver={(event) => {
                        if (event.dataTransfer.types.includes("text/relay-card") || event.dataTransfer.types.includes("text/relay-group")) {
                          event.preventDefault();
                          if (event.dataTransfer.types.includes("text/relay-card")) setDragOverGroupId(group.id);
                        }
                      }}
                      onDragEnter={(event) => {
                        if (event.dataTransfer.types.includes("text/relay-card")) setDragOverGroupId(group.id);
                      }}
                      onDragLeave={(event) => {
                        const nextTarget = event.relatedTarget;
                        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                        setDragOverGroupId((current) => current === group.id ? null : current);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDragOverGroupId(null);
                        const cardId = event.dataTransfer.getData("text/relay-card");
                        if (cardId !== "") {
                          onMoveCard(cardId, column.id, group.id);
                          return;
                        }
                        const sourceGroupId = event.dataTransfer.getData("text/relay-group");
                        if (sourceGroupId !== "" && sourceGroupId !== group.id) onReorderGroups(sourceGroupId, group.id);
                      }}
                    >
                      <header>
                        <span><Rows3 size={11} /> {group.name}</span>
                        <div className="group-header-actions">
                          {canReorder && (
                            <>
                              <button type="button" disabled={groupIndex <= 0} onClick={() => {
                                const target = groups[groupIndex - 1];
                                if (target !== undefined) onReorderGroups(group.id, target.id);
                              }} aria-label={`Move ${group.name} up`}><ArrowLeft size={11} /></button>
                              <button type="button" disabled={groupIndex >= board.phases.length - 1} onClick={() => {
                                const target = groups[groupIndex + 1];
                                if (target !== undefined) onReorderGroups(group.id, target.id);
                              }} aria-label={`Move ${group.name} down`}><ArrowRight size={11} /></button>
                            </>
                          )}
                          <b>{groupedCards.length}</b>
                        </div>
                      </header>
                      <div className="card-group-body">
                        {groupedCards.map((card) => (
                          <CardTile
                            key={card.id}
                            card={card}
                            columns={board.columns}
                            groupName={group.name}
                            tagRegistry={tagRegistry}
                            onDelete={() => onDeleteCard(card.id)}
                            onDuplicate={() => onDuplicateCard(card.id)}
                            onArchive={() => onArchiveCard(card.id)}
                            onMove={(columnId) => onMoveCard(card.id, columnId)}
                            onOpen={() => onOpenCard(card.id)}
                            onToggleBlocked={() => onToggleCardBlocked(card.id)}
                          />
                        ))}
                        {addingTo?.columnId === column.id && addingTo.phaseId === group.id ? (
                          <form className="quick-add" onSubmit={(event) => {
                            event.preventDefault();
                            if (newTitle.trim() === "") return;
                            onAddCard(column.id, group.id, newTitle.trim());
                            setNewTitle("");
                            setAddingTo(null);
                          }}>
                            <textarea autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="A concrete, verifiable outcome" />
                            <div><button type="submit">Add Card</button><button type="button" onClick={() => setAddingTo(null)}><X size={15} /></button></div>
                          </form>
                        ) : (
                          <button className="add-card-button" type="button" onClick={() => setAddingTo({ columnId: column.id, phaseId: group.id })}><Plus size={15} /> Add Card</button>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </section>
          );
        })}
        <section className="kanban-lane new-holder-column">
          {newHolderOpen || addingColumn ? (
            <form className="new-holder-form" onSubmit={(event) => {
              event.preventDefault();
              if (newColumnName.trim() === "") return;
              onAddColumn(newColumnName.trim());
              setNewColumnName("");
              setAddingColumn(false);
              setNewHolderOpen(false);
            }}>
              <span><Columns3 size={15} /> New Holder</span>
              <input autoFocus value={newColumnName} onChange={(event) => setNewColumnName(event.target.value)} placeholder="Holder name" maxLength={60} />
              <div>
                <button type="submit" disabled={newColumnName.trim() === ""}><Check size={14} /> Create</button>
                <button type="button" onClick={() => { setAddingColumn(false); setNewHolderOpen(false); setNewColumnName(""); }}><X size={14} /> Cancel</button>
              </div>
            </form>
          ) : (
            <button className="new-holder-button" type="button" onClick={() => setNewHolderOpen(true)} aria-label="Create holder">
              <Plus size={24} />
              <span>New Holder</span>
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

function PlanView({ board, onSave }: { board: RelayBoard; onSave: (plan: string) => void }) {
  const [value, setValue] = useState(board.plan);
  const saved = value === board.plan;
  const wordCount = value.trim() === "" ? 0 : value.trim().split(/\s+/).length;
  const lineCount = value === "" ? 0 : value.split("\n").length;

  useEffect(() => {
    if (value === board.plan) return;
    const timeout = window.setTimeout(() => {
      onSave(value);
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [board.plan, onSave, value]);

  return (
    <div className="plan-layout">
      <section className="plan-editor panel">
        <div className="editor-toolbar">
          <div><span className="save-state"><i className={saved ? "saved" : "saving"} />{saved ? "All changes saved" : "Saving draft..."}</span></div>
          <div><span className="editor-stat">{wordCount} words</span></div>
        </div>
        <textarea aria-label="Detailed plan Markdown" value={value} onChange={(event) => setValue(event.target.value)} spellCheck />
      </section>
      <aside className="plan-inspector">
        <section className="panel plan-score local-plan-summary">
          <FileText size={22} />
          <h3>Stored locally</h3>
          <p>This plan contains {wordCount} words across {lineCount} lines. Changes autosave to this device.</p>
        </section>
        <section className="panel version-card">
          <span className="eyebrow">Current Document</span>
          <div><History size={17} /><p><strong>Local autosave</strong><span>{saved ? "Saved" : "Saving"}</span></p></div>
        </section>
      </aside>
    </div>
  );
}

function TimelineView({ board, onSavePhase }: { board: RelayBoard; onSavePhase: (phaseId: string, update: Partial<RelayBoard["phases"][number]>) => void }) {
  return (
    <div className="timeline-layout">
      <section className="timeline-summary panel">
        <div><span className="eyebrow">Recorded Completion</span><strong>{board.progress}%</strong><p>Current progress stored with this board</p></div>
        <div className="phase-line" aria-hidden="true">{board.phases.map((phase) => <span key={phase.id} className={phase.status} style={{ flex: Math.max(1, phase.progress) }} />)}</div>
      </section>
      <section className="phase-list">
        {board.phases.map((phase, index) => (
          <article className="phase-card panel" key={phase.id}>
            <span className={`phase-index ${phase.status}`}>{phase.status === "complete" ? <Check size={17} /> : index + 1}</span>
            <div className="phase-copy editable-phase">
              <span className="eyebrow">Group {index + 1}</span>
              <input value={phase.name} onChange={(event) => onSavePhase(phase.id, { name: event.target.value })} maxLength={80} aria-label={`Group ${index + 1} name`} />
              <textarea value={phase.objective} onChange={(event) => onSavePhase(phase.id, { objective: event.target.value })} maxLength={600} aria-label={`Group ${index + 1} objective`} placeholder="What does this group accomplish?" />
            </div>
            <div className="phase-progress"><strong>{phase.progress}%</strong><span><i style={{ width: `${phase.progress}%` }} /></span></div>
          </article>
        ))}
      </section>
    </div>
  );
}

function ContextView({ board, onAddContext }: { board: RelayBoard; onAddContext: (input: Omit<ContextRecord, "id" | "updatedAt">) => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<ContextRecord["category"]>("Current state");
  const [confidence, setConfidence] = useState<ContextRecord["confidence"]>("High");

  return (
    <div className="context-layout">
      <section className="context-intro panel">
        <div className="context-symbol"><BrainCircuit size={24} /></div>
        <div><span className="eyebrow">Focused Memory</span><h2>What future sessions need to know</h2><p>Active, high-confidence context is ranked into compact packets. Outdated records stay in history without polluting current work.</p></div>
      </section>
      <form className="context-form panel" onSubmit={(event) => {
        event.preventDefault();
        if (title.trim() === "" || content.trim() === "") return;
        onAddContext({ title: title.trim(), content: content.trim(), category, confidence });
        setTitle("");
        setContent("");
        setCategory("Current state");
        setConfidence("High");
      }}>
        <div className="decision-form-top">
          <label><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} placeholder="Context Title" /></label>
          <label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value as ContextRecord["category"])}>
            <option>Architecture</option>
            <option>Current state</option>
            <option>Decision</option>
            <option>Important file</option>
            <option>Warning</option>
          </select></label>
        </div>
        <label><span>Context</span><textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={3000} placeholder="What should a future session know?" /></label>
        <div className="context-form-footer">
          <label><span>Confidence</span><select value={confidence} onChange={(event) => setConfidence(event.target.value as ContextRecord["confidence"])}><option>High</option><option>Medium</option></select></label>
          <button className="primary-button compact" type="submit" disabled={title.trim() === "" || content.trim() === ""}><BrainCircuit size={15} /> Add Context</button>
        </div>
      </form>
      <div className="context-grid">
        {board.context.map((item) => (
          <article className={cx("context-card", item.category === "Warning" && "warning")} key={item.id}>
            <div className="context-card-top"><span>{item.category}</span><b><i /> {item.confidence}</b></div>
            <h3>{item.title}</h3><p>{item.content}</p>
            <footer><span>{formatRecordedTime(item.updatedAt)}</span></footer>
          </article>
        ))}
      </div>
      {board.context.length === 0 && <div className="empty-state"><BrainCircuit size={24} /><h3>No Context Recorded</h3><p>Context will appear here after it is added to this board.</p></div>}
    </div>
  );
}

function DecisionsView({ board, onAddDecision }: { board: RelayBoard; onAddDecision: (input: { title: string; decision: string; reason: string; status: "Accepted" | "Proposed" }) => void }) {
  const [title, setTitle] = useState("");
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"Accepted" | "Proposed">("Accepted");

  return (
    <div className="record-list">
      <div className="record-list-heading"><div><span className="eyebrow">Decision Log</span><h2>Choices Future Work Must Preserve</h2></div></div>
      <form className="decision-form panel" onSubmit={(event) => {
        event.preventDefault();
        if (title.trim() === "" || decision.trim() === "") return;
        onAddDecision({ title: title.trim(), decision: decision.trim(), reason: reason.trim(), status });
        setTitle("");
        setDecision("");
        setReason("");
        setStatus("Accepted");
      }}>
        <div className="decision-form-top">
          <label><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} placeholder="Decision Title" /></label>
          <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as "Accepted" | "Proposed")}><option>Accepted</option><option>Proposed</option></select></label>
        </div>
        <label><span>Decision</span><textarea value={decision} onChange={(event) => setDecision(event.target.value)} maxLength={2000} placeholder="What did the project decide?" /></label>
        <label><span>Rationale</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} placeholder="Why is this the right tradeoff?" /></label>
        <button className="primary-button compact" type="submit" disabled={title.trim() === "" || decision.trim() === ""}><Lightbulb size={15} /> Record Decision</button>
      </form>
      {board.decisions.map((decision) => (
        <article className="decision-card panel" key={decision.id}>
          <div className="decision-status"><Lightbulb size={18} /><span>{decision.status}</span></div>
          <div><h3>{decision.title}</h3><p>{decision.decision}</p><small><strong>Why:</strong> {decision.reason}</small></div>
        </article>
      ))}
      {board.decisions.length === 0 && <div className="empty-state"><Lightbulb size={24} /><h3>No Decisions Recorded</h3><p>Accepted project decisions will appear here.</p></div>}
    </div>
  );
}

function ActivityView({ board }: { board: RelayBoard }) {
  return (
    <div className="activity-view">
      <div className="record-list-heading"><div><span className="eyebrow">Audit History</span><h2>Meaningful Project Activity</h2></div></div>
      <section className="activity-timeline panel">
        {board.activity.map((item) => (
          <ActivityLine activity={item} className="timeline-event" key={item.id} />
        ))}
      </section>
      {board.activity.length === 0 && <div className="empty-state"><History size={24} /><h3>No Activity Recorded</h3><p>Board changes will appear here.</p></div>}
    </div>
  );
}

function BlockersView({ board }: { board: RelayBoard }) {
  const blockedCards = board.cards.filter((card) => card.blocked);
  return (
    <div className="record-list">
      <div className="record-list-heading"><div><span className="eyebrow">Blocked Work</span><h2>Cards that cannot move forward</h2></div></div>
      {blockedCards.map((card) => (
        <article className="decision-card panel" key={card.id}>
          <div className="decision-status blocked-status"><AlertTriangle size={18} /><span>Blocked</span></div>
          <div><h3>{card.title}</h3><p>{card.description || "No blocker details recorded."}</p></div>
        </article>
      ))}
      {blockedCards.length === 0 && <div className="empty-state blockers-empty"><CheckCircle2 size={26} /><h3>No active blockers</h3><p>No cards on this board are currently marked blocked.</p></div>}
    </div>
  );
}

function CardDetail({
  board,
  card,
  tagRegistry,
  onAddNote,
  onCycleTagTone,
  onClose,
  onSave,
}: {
  board: RelayBoard;
  card: RelayCard;
  tagRegistry: RelayTag[];
  onAddNote: (cardId: string, body: string) => void;
  onCycleTagTone: (tag: string) => void;
  onClose: () => void;
  onSave: (cardId: string, update: Partial<RelayCard>) => void;
}) {
  const titleId = useId();
  const TypeIcon = typeIcons[card.type];
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [owner, setOwner] = useState(card.owner);
  const [type, setType] = useState<RelayCard["type"]>(card.type);
  const [priority, setPriority] = useState<RelayCard["priority"]>(card.priority);
  const [phaseId, setPhaseId] = useState(card.phaseId);
  const [progress, setProgress] = useState(card.progress);
  const [criteriaDone, setCriteriaDone] = useState(card.criteriaDone);
  const [criteriaTotal, setCriteriaTotal] = useState(card.criteriaTotal);
  const [blocked, setBlocked] = useState(card.blocked);
  const [tags, setTags] = useState(card.tags ?? []);
  const [note, setNote] = useState("");
  const notes = card.notes ?? [];
  const baseGroups = board.phases.length > 0 ? board.phases : [{ id: "unphased", name: "Ungrouped", objective: "", progress: 0, status: "in_progress" as const }];
  const groups = baseGroups.some((group) => group.id === card.phaseId)
    ? baseGroups
    : [...baseGroups, { id: card.phaseId, name: "Ungrouped", objective: "", progress: 0, status: "planned" as const }];

  function saveCard() {
    onSave(card.id, {
      title: title.trim() || card.title,
      description: description.trim(),
      owner: owner.trim() || "Unassigned",
      type,
      priority,
      phaseId,
      progress: Math.max(0, Math.min(100, progress)),
      criteriaDone: Math.max(0, criteriaDone),
      criteriaTotal: Math.max(0, criteriaTotal),
      blocked,
      tags,
    });
  }

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="card-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-header"><span className={`type-chip ${card.type}`}><TypeIcon size={12} /> {card.type}</span><button className="icon-button" type="button" onClick={onClose} aria-label="Close card"><X size={18} /></button></div>
        <h2 id={titleId} className="sr-only">Edit {card.title}</h2>
        <form className="card-edit-form" onSubmit={(event) => { event.preventDefault(); saveCard(); }}>
          <label className="card-title-field">
            <span>Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} required />
          </label>
          <label>
            <span>Description</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} placeholder="What has to be true when this card is done?" />
          </label>
          <div className="drawer-properties editable-properties">
            <fieldset className="property-card group-property">
              <legend>Group</legend>
              <div className="group-choice-list">
                {groups.map((phase) => <button key={phase.id} className={cx(phaseId === phase.id && "selected")} type="button" onClick={() => setPhaseId(phase.id)}><Milestone size={13} /> {phase.name}</button>)}
              </div>
            </fieldset>
            <label className="property-card owner-property"><span>Owner</span><div><UserRound size={15} /><input value={owner} onChange={(event) => setOwner(event.target.value)} maxLength={80} /></div></label>
            <fieldset className="property-card type-property">
              <legend>Type</legend>
              <div className="choice-grid type-choice-grid">
                {cardTypes.map((item) => {
                  const OptionIcon = typeIcons[item];
                  return <button key={item} className={cx("type-choice", item, type === item && "selected")} type="button" aria-pressed={type === item} onClick={() => setType(item)}><OptionIcon size={15} /> {item.replace("_", " ")}</button>;
                })}
              </div>
            </fieldset>
            <fieldset className="property-card priority-property">
              <legend>Priority</legend>
              <div className="priority-ladder">
                {priorities.map((item) => <button key={item} className={cx(item, priority === item && "selected")} type="button" aria-pressed={priority === item} onClick={() => setPriority(item)}><span className={`priority-dot ${item}`} /> {item}</button>)}
              </div>
            </fieldset>
            <label className="property-card progress-property"><span>Progress</span><div className="range-row"><input type="range" min="0" max="100" value={progress} onChange={(event) => setProgress(Number(event.target.value))} /><strong>{progress}%</strong></div></label>
            <label className="property-card"><span>Criteria done</span><input type="number" min="0" value={criteriaDone} onChange={(event) => setCriteriaDone(Number(event.target.value))} /></label>
            <label className="property-card"><span>Criteria total</span><input type="number" min="0" value={criteriaTotal} onChange={(event) => setCriteriaTotal(Number(event.target.value))} /></label>
            <label className="blocked-toggle"><input type="checkbox" checked={blocked} onChange={(event) => setBlocked(event.target.checked)} /><span>Blocked</span></label>
          </div>
          <div className="card-edit-field">
            <span>Tags</span>
            <TagEditor tags={tags} registry={tagRegistry} onChange={setTags} onCycleTone={onCycleTagTone} />
          </div>
          <button className="primary-button drawer-action" type="submit"><Edit3 size={16} /> Save Card</button>
        </form>
        <section className="drawer-section notes-section">
          <div><span className="eyebrow">Notes</span></div>
          <form className="note-form" onSubmit={(event) => {
            event.preventDefault();
            if (note.trim() === "") return;
            onAddNote(card.id, note.trim());
            setNote("");
          }}>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What did you do? How did you do it?" />
            <button className="secondary-button" type="submit" disabled={note.trim() === ""}>Add Note</button>
          </form>
          <div className="note-list">
            {notes.map((item, index) => (
              <article key={`${item.id}-${item.createdAt}-${index}`}>
                <p>{item.body}</p>
                <span>{item.author} - {formatRecordedTime(item.createdAt)}</span>
              </article>
            ))}
            {notes.length === 0 && <p className="panel-empty">No notes have been recorded for this card.</p>}
          </div>
        </section>
      </aside>
    </div>
  );
}

export function RelayApp() {
  const data = useSyncExternalStore(
    subscribeWorkspace,
    getWorkspaceSnapshot,
    getServerWorkspaceSnapshot,
  );
  const [directoryId, setDirectoryId] = useState("all");
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [view, setView] = useState<RelayView>("board");
  const [workspaceTab, setWorkspaceTab] = useState<"dashboard" | "discovery">("dashboard");
  const [discoveryDirectoryPath, setDiscoveryDirectoryPath] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedDirectoryIds, setExpandedDirectoryIds] = useState<Set<string>>(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gitBoardId, setGitBoardId] = useState<string | null>(null);
  const [directoryMenu, setDirectoryMenu] = useState<{ directoryId: string; x: number; y: number } | null>(null);
  const [textModal, setTextModal] = useState<
    | { kind: "rename-board"; boardId: string }
    | { kind: "rename-directory"; directoryId: string }
    | null
  >(null);
  const [confirmModal, setConfirmModal] = useState<
    | { kind: "delete-board"; boardId: string }
    | { kind: "delete-card"; boardId: string; cardId: string }
    | { kind: "remove-directory"; directoryId: string }
    | null
  >(null);
  const [directoryBoardAction, setDirectoryBoardAction] = useState<"move" | "delete">("move");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [storeReady, setStoreReady] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const settings = data.settings ?? defaultRelaySettings;
  const tagRegistry = data.tags ?? [];
  const actorName = settings.displayName.trim() || localActor;
  const humanActivity = (
    input: Omit<ActivityRecord, "actor" | "actorKind" | "id" | "time">,
    recordedAt: string,
  ): ActivityRecord => ({
    id: crypto.randomUUID(),
    actor: actorName,
    actorKind: "human",
    time: recordedAt,
    ...input,
  });
  const selectedBoard = data.boards.find((board) => board.id === selectedBoardId);
  const gitBoard = data.boards.find((board) => board.id === gitBoardId);
  const selectedCard = selectedBoard?.cards.find((card) => card.id === selectedCardId);
  const boardsByDirectory = useMemo(() => {
    const map = new Map<string, RelayBoard[]>();
    for (const board of data.boards) {
      const boards = map.get(board.directoryId);
      if (boards === undefined) map.set(board.directoryId, [board]);
      else boards.push(board);
    }
    return map;
  }, [data.boards]);

  useEffect(() => {
    if (!storeReady) return;
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function applyDocumentTheme() {
      root.classList.remove("theme-light", "theme-dark", "theme-system");
      root.classList.add(`theme-${settings.appearance}`);
      root.style.colorScheme = settings.appearance === "dark" || (settings.appearance === "system" && media.matches) ? "dark" : "light";
    }

    applyDocumentTheme();
    try {
      window.localStorage.setItem("relay:appearance", settings.appearance);
    } catch {
      // Preference persistence through the desktop workspace still applies.
    }

    if (settings.appearance !== "system") return;
    media.addEventListener("change", applyDocumentTheme);
    return () => media.removeEventListener("change", applyDocumentTheme);
  }, [settings.appearance, storeReady]);

  function showToast(message: string, tone: ToastMessage["tone"] = "info") {
    const id = crypto.randomUUID();
    setToasts((current) => [{ id, tone, message }, ...current].slice(0, 4));
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4500);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await initializeWorkspaceStore();
        const info = await getLocalStorageInfo().catch(() => null);
        if (active) setStoragePath(info?.dataFilePath ?? null);
      } catch (error: unknown) {
        if (active) setStoreError(error instanceof Error ? error.message : "Relay could not open the local workspace.");
      } finally {
        if (active) setStoreReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function updateBoard(boardId: string, update: (board: RelayBoard) => RelayBoard) {
    setWorkspace((current) => ({
      ...current,
      boards: current.boards.map((board) => board.id === boardId ? update(board) : board),
    }));
  }

  function updateSettings(update: Partial<RelaySettings>) {
    setWorkspace((current) => {
      const currentSettings = current.settings ?? defaultRelaySettings;
      return {
        ...current,
        settings: {
          ...currentSettings,
          ...update,
          activityLimit: Math.max(0, Math.min(20, update.activityLimit ?? currentSettings.activityLimit)),
          boardColumnWidth: Math.max(200, Math.min(280, update.boardColumnWidth ?? currentSettings.boardColumnWidth)),
          displayName: update.displayName ?? currentSettings.displayName,
        },
      };
    });
  }

  function openStorage() {
    void openLocalStorageLocation();
  }

  function cycleTagTone(tag: string) {
    const name = cleanTag(tag);
    if (name === "") return;
    setWorkspace((current) => {
      const currentTags = current.tags ?? [];
      const existing = currentTags.find((item) => tagKey(item.name) === tagKey(name));
      const nextTags = existing === undefined
        ? [...currentTags, { name, tone: tagTone(name, currentTags) }]
        : currentTags.map((item) => tagKey(item.name) === tagKey(name) ? { ...item, tone: nextTagTone(item.tone) } : item);
      return { ...current, tags: nextTags };
    });
  }

  function requestDeleteBoard(boardId: string) {
    setConfirmModal({ kind: "delete-board", boardId });
  }

  function deleteBoardNow(boardId: string) {
    setWorkspace((current) => ({
      ...current,
      boards: current.boards.filter((candidate) => candidate.id !== boardId),
    }));
    if (selectedBoardId === boardId) {
      setSelectedBoardId(null);
      setSelectedCardId(null);
    }
  }

  function toggleBoardArchived(boardId: string) {
    const recordedAt = now();
    updateBoard(boardId, (board) => {
      const archived = board.archivedAt === undefined;
      return {
        ...board,
        ...(archived ? { archivedAt: recordedAt } : { archivedAt: undefined }),
        activity: [humanActivity({ action: archived ? "archived board" : "restored board", target: board.name, tone: archived ? "orange" : "green" }, recordedAt), ...board.activity],
        lastActivity: recordedAt,
      };
    });
  }

  function renameBoard(boardId: string) {
    setTextModal({ kind: "rename-board", boardId });
  }

  function renameBoardNow(boardId: string, value: string) {
    const board = data.boards.find((candidate) => candidate.id === boardId);
    if (board === undefined) return;
    const nextName = value.trim().slice(0, 120);
    if (nextName === "" || nextName === board.name) return;
    const recordedAt = now();
    updateBoard(boardId, (currentBoard) => ({
      ...currentBoard,
      name: nextName,
      activity: [humanActivity({ action: "renamed board", target: `${currentBoard.name} to ${nextName}`, tone: "violet" }, recordedAt), ...currentBoard.activity],
      lastActivity: recordedAt,
    }));
  }

  function requestRemoveDirectory(targetDirectoryId: string) {
    setDirectoryBoardAction("move");
    setConfirmModal({ kind: "remove-directory", directoryId: targetDirectoryId });
  }

  function removeDirectoryFromRelay(targetDirectoryId: string, boardAction: "move" | "delete" = "move") {
    const directory = data.directories.find((candidate) => candidate.id === targetDirectoryId);
    if (directory === undefined) return;
    const linkedBoards = data.boards.filter((board) => board.directoryId === targetDirectoryId);
    setWorkspace((current) => ({
      ...current,
      directories: (() => {
        const remaining = current.directories.filter((candidate) => candidate.id !== targetDirectoryId);
        if (linkedBoards.length === 0 || boardAction === "delete") return remaining;
        return remaining.some((candidate) => candidate.id === "unfiled") ? remaining : [...remaining, { id: "unfiled", name: "Unfiled" }];
      })(),
      boards: boardAction === "delete"
        ? current.boards.filter((board) => board.directoryId !== targetDirectoryId)
        : current.boards.map((board) => board.directoryId === targetDirectoryId ? { ...board, directoryId: "unfiled" } : board),
    }));
    if (directoryId === targetDirectoryId) setDirectoryId("all");
    if (linkedBoards.some((board) => board.id === selectedBoardId)) {
      setSelectedBoardId(null);
      setSelectedCardId(null);
    }
    setDirectoryMenu(null);
  }

  function renameDirectory(directoryId: string) {
    setTextModal({ kind: "rename-directory", directoryId });
  }

  function renameDirectoryNow(directoryId: string, name: string) {
    const nextName = name.trim().slice(0, 120);
    if (nextName === "") return;
    setWorkspace((current) => ({
      ...current,
      directories: current.directories.map((directory) => directory.id === directoryId ? { ...directory, name: nextName } : directory),
      boards: current.boards.map((board) => board.directoryId === directoryId ? {
        ...board,
        activity: [humanActivity({ action: "renamed directory", target: nextName, tone: "violet" }, now()), ...board.activity],
      } : board),
    }));
  }

  async function openDirectory(directory: Directory) {
    if (directory.path === undefined) {
      showToast("This directory entry does not have a linked filesystem path.", "error");
      return;
    }
    const result = await openDirectoryPath(directory.path);
    showToast(result.opened ? "Directory opened." : result.error ?? "Directory could not be opened.", result.opened ? "success" : "error");
  }

  async function openDirectoryTerminal(directory: Directory) {
    if (directory.path === undefined) {
      showToast("This directory entry does not have a linked filesystem path.", "error");
      return;
    }
    const result = await openDirectoryInTerminal(directory.path);
    showToast(result.opened ? "Terminal opened." : result.error ?? "Terminal could not be opened.", result.opened ? "success" : "error");
  }

  async function copyDirectoryPath(directory: Directory) {
    if (directory.path === undefined) {
      showToast("This directory entry does not have a linked filesystem path.", "error");
      return;
    }
    const copied = await copyTextToClipboard(directory.path);
    showToast(copied ? "Directory path copied." : "Directory path could not be copied.", copied ? "success" : "error");
  }

  function moveCard(cardId: string, columnId: string, phaseId?: string) {
    if (selectedBoard === undefined) return;
    const recordedAt = now();
    updateBoard(selectedBoard.id, (board) => {
      const cards = board.cards.map((card) => card.id === cardId ? { ...card, columnId, ...(phaseId === undefined ? {} : { phaseId }), updatedAt: recordedAt } : card);
      const targetColumn = board.columns.find((column) => column.id === columnId)?.name ?? columnId;
      const targetGroup = phaseId === undefined ? undefined : board.phases.find((phase) => phase.id === phaseId)?.name ?? "Ungrouped";
      return {
        ...board,
        cards,
        activeTasks: activeTaskCount(cards),
        activity: [humanActivity({ action: "moved a card to", target: targetGroup === undefined ? targetColumn : `${targetGroup} / ${targetColumn}`, tone: "blue" }, recordedAt), ...board.activity],
        lastActivity: recordedAt,
      };
    });
  }

  function reorderGroups(phaseId: string, targetPhaseId: string) {
    if (selectedBoard === undefined || phaseId === targetPhaseId) return;
    const recordedAt = now();
    updateBoard(selectedBoard.id, (board) => {
      const sourceIndex = board.phases.findIndex((phase) => phase.id === phaseId);
      const targetIndex = board.phases.findIndex((phase) => phase.id === targetPhaseId);
      if (sourceIndex === -1 || targetIndex === -1) return board;
      const phases = [...board.phases];
      const [source] = phases.splice(sourceIndex, 1);
      if (source === undefined) return board;
      phases.splice(targetIndex, 0, source);
      return {
        ...board,
        phases,
        activity: [humanActivity({ action: "reordered group", target: source.name, tone: "violet" }, recordedAt), ...board.activity],
        lastActivity: recordedAt,
      };
    });
  }

  function addGroup(name: string) {
    if (selectedBoard === undefined) return;
    const recordedAt = now();
    updateBoard(selectedBoard.id, (board) => ({
      ...board,
      phases: [
        ...board.phases,
        { id: crypto.randomUUID(), name, objective: "", progress: 0, status: "planned" },
      ],
      activity: [humanActivity({ action: "created group", target: name, tone: "green" }, recordedAt), ...board.activity],
      lastActivity: recordedAt,
    }));
  }

  function addColumn(name: string) {
    if (selectedBoard === undefined) return;
    const recordedAt = now();
    updateBoard(selectedBoard.id, (board) => ({
      ...board,
      columns: [...board.columns, { id: crypto.randomUUID(), name, tone: columnTones[board.columns.length % columnTones.length] ?? "gray" }],
      activity: [humanActivity({ action: "created holder", target: name, tone: "green" }, recordedAt), ...board.activity],
      lastActivity: recordedAt,
    }));
  }

  function renameColumn(columnId: string, name: string) {
    if (selectedBoard === undefined) return;
    const recordedAt = now();
    updateBoard(selectedBoard.id, (board) => {
      const existing = board.columns.find((column) => column.id === columnId);
      if (existing === undefined || existing.name === name) return board;
      return {
        ...board,
        columns: board.columns.map((column) => column.id === columnId ? { ...column, name } : column),
        activity: [humanActivity({ action: "renamed holder", target: `${existing.name} to ${name}`, tone: "violet" }, recordedAt), ...board.activity],
        lastActivity: recordedAt,
      };
    });
  }

  function reorderColumn(columnId: string, direction: -1 | 1) {
    if (selectedBoard === undefined) return;
    const recordedAt = now();
    updateBoard(selectedBoard.id, (board) => {
      const sourceIndex = board.columns.findIndex((column) => column.id === columnId);
      const targetIndex = sourceIndex + direction;
      if (sourceIndex === -1 || targetIndex < 0 || targetIndex >= board.columns.length) return board;
      const columns = [...board.columns];
      const [source] = columns.splice(sourceIndex, 1);
      if (source === undefined) return board;
      columns.splice(targetIndex, 0, source);
      return {
        ...board,
        columns,
        activity: [humanActivity({ action: "reordered holder", target: source.name, tone: "violet" }, recordedAt), ...board.activity],
        lastActivity: recordedAt,
      };
    });
  }

  function deleteColumn(columnId: string) {
    if (selectedBoard === undefined) return;
    const recordedAt = now();
    updateBoard(selectedBoard.id, (board) => {
      if (board.columns.length <= 1) return board;
      const removed = board.columns.find((column) => column.id === columnId);
      const fallbackColumn = board.columns.find((column) => column.id !== columnId);
      if (removed === undefined || fallbackColumn === undefined) return board;
      const columns = board.columns.filter((column) => column.id !== columnId);
      const cards = board.cards.map((card) => card.columnId === columnId ? { ...card, columnId: fallbackColumn.id, updatedAt: recordedAt } : card);
      return {
        ...board,
        columns,
        cards,
        activeTasks: activeTaskCount(cards),
        activity: [humanActivity({ action: "deleted holder", target: removed.name, tone: "orange" }, recordedAt), ...board.activity],
        lastActivity: recordedAt,
      };
    });
  }

  function updatePhase(phaseId: string, update: Partial<RelayBoard["phases"][number]>) {
    if (selectedBoard === undefined) return;
    const recordedAt = now();
    updateBoard(selectedBoard.id, (board) => ({
      ...board,
      phases: board.phases.map((phase) => phase.id === phaseId ? { ...phase, ...update } : phase),
      lastActivity: recordedAt,
    }));
  }

  function addCard(columnId: string, phaseId: string, title: string) {
    if (selectedBoard === undefined) return;
    const recordedAt = now();
    updateBoard(selectedBoard.id, (board) => {
      const cards = [...board.cards, { id: crypto.randomUUID(), title, description: "", columnId, phaseId, type: "task" as const, priority: "normal" as const, tags: [], notes: [], progress: 0, criteriaDone: 0, criteriaTotal: 0, blocked: false, owner: "Unassigned", updatedAt: recordedAt }];
      return {
        ...board,
        cards,
        activeTasks: activeTaskCount(cards),
        activity: [humanActivity({ action: "created card", target: title, tone: "blue" }, recordedAt), ...board.activity],
        lastActivity: recordedAt,
      };
    });
  }

  function deleteCard(cardId: string) {
    if (selectedBoard === undefined) return;
    setConfirmModal({ kind: "delete-card", boardId: selectedBoard.id, cardId });
  }

  function deleteCardNow(boardId: string, cardId: string) {
    const boardToUpdate = data.boards.find((board) => board.id === boardId);
    const card = boardToUpdate?.cards.find((candidate) => candidate.id === cardId);
    if (boardToUpdate === undefined || card === undefined) return;
    const recordedAt = now();
    updateBoard(boardId, (board) => {
      const cards = board.cards.filter((candidate) => candidate.id !== cardId);
      return {
        ...board,
        cards,
        activeTasks: activeTaskCount(cards),
        blockers: blockerCount(cards),
        activity: [humanActivity({ action: "deleted card", target: card.title, tone: "orange" }, recordedAt), ...board.activity],
        lastActivity: recordedAt,
      };
    });
    if (selectedCardId === cardId) setSelectedCardId(null);
  }

  function duplicateCard(cardId: string) {
    if (selectedBoard === undefined) return;
    const source = selectedBoard.cards.find((candidate) => candidate.id === cardId);
    if (source === undefined) return;
    const recordedAt = now();
    updateBoard(selectedBoard.id, (board) => {
      const copy = {
        ...source,
        id: crypto.randomUUID(),
        title: `${source.title} Copy`.slice(0, 180),
        notes: (source.notes ?? []).map((note) => ({ ...note, id: crypto.randomUUID() })),
        updatedAt: recordedAt,
      };
      const cards = [...board.cards, copy];
      return {
        ...board,
        cards,
        activeTasks: activeTaskCount(cards),
        blockers: blockerCount(cards),
        activity: [humanActivity({ action: "duplicated card", target: source.title, tone: "blue" }, recordedAt), ...board.activity],
        lastActivity: recordedAt,
      };
    });
  }

  function toggleCardBlocked(cardId: string) {
    if (selectedBoard === undefined) return;
    const card = selectedBoard.cards.find((candidate) => candidate.id === cardId);
    if (card === undefined) return;
    saveCard(cardId, { blocked: !card.blocked });
  }

  function toggleCardArchived(cardId: string) {
    if (selectedBoard === undefined) return;
    const card = selectedBoard.cards.find((candidate) => candidate.id === cardId);
    if (card === undefined) return;
    const archived = card.archivedAt === undefined;
    saveCard(cardId, { archivedAt: archived ? now() : undefined });
  }

  function saveCard(cardId: string, update: Partial<RelayCard>) {
    if (selectedBoard === undefined) return;
    const recordedAt = now();
    updateBoard(selectedBoard.id, (board) => {
      const cards = board.cards.map((card) => card.id === cardId ? { ...card, ...update, updatedAt: recordedAt } : card);
      const changedCard = cards.find((card) => card.id === cardId);
      return {
        ...board,
        cards,
        activeTasks: activeTaskCount(cards),
        blockers: blockerCount(cards),
        activity: changedCard === undefined ? board.activity : [humanActivity({ action: update.archivedAt !== undefined ? "archived card" : cardArchivedCleared(update) ? "restored card" : "edited card", target: changedCard.title, tone: update.archivedAt !== undefined ? "orange" : cardArchivedCleared(update) ? "green" : "blue" }, recordedAt), ...board.activity],
        lastActivity: recordedAt,
      };
    });
  }

  function addCardNote(cardId: string, body: string) {
    if (selectedBoard === undefined) return;
    const recordedAt = now();
    updateBoard(selectedBoard.id, (board) => {
      const cards = board.cards.map((card) => card.id === cardId ? {
        ...card,
        notes: [{ id: crypto.randomUUID(), body, author: actorName, createdAt: recordedAt }, ...(card.notes ?? [])],
        updatedAt: recordedAt,
      } : card);
      const changedCard = cards.find((card) => card.id === cardId);
      return {
        ...board,
        cards,
        activity: changedCard === undefined ? board.activity : [humanActivity({ action: "added note to", target: changedCard.title, tone: "violet" }, recordedAt), ...board.activity],
        lastActivity: recordedAt,
      };
    });
  }

  function addDecision(input: { title: string; decision: string; reason: string; status: "Accepted" | "Proposed" }) {
    if (selectedBoard === undefined) return;
    const recordedAt = now();
    updateBoard(selectedBoard.id, (board) => ({
      ...board,
      decisions: [{ id: crypto.randomUUID(), ...input }, ...board.decisions],
      activity: [humanActivity({ action: "recorded decision", target: input.title, tone: "green" }, recordedAt), ...board.activity],
      lastActivity: recordedAt,
    }));
  }

  function addContext(input: Omit<ContextRecord, "id" | "updatedAt">) {
    if (selectedBoard === undefined) return;
    const recordedAt = now();
    updateBoard(selectedBoard.id, (board) => ({
      ...board,
      context: [{ id: crypto.randomUUID(), ...input, updatedAt: recordedAt }, ...board.context],
      activity: [humanActivity({ action: "added context", target: input.title, tone: "green" }, recordedAt), ...board.activity],
      lastActivity: recordedAt,
    }));
  }

  function directoryContextItems(directory: Directory): ContextMenuItem[] {
    const hasPath = directory.path !== undefined;
    return [
      {
        key: "open",
        label: "Open Directory",
        icon: <Folder size={14} />,
        disabled: !hasPath,
        disabledReason: "This directory entry is not linked to a filesystem path.",
        onSelect: () => { void openDirectory(directory); },
      },
      {
        key: "terminal",
        label: "Open in Terminal",
        icon: <Terminal size={14} />,
        disabled: !hasPath,
        disabledReason: "This directory entry is not linked to a filesystem path.",
        onSelect: () => { void openDirectoryTerminal(directory); },
      },
      {
        key: "copy-path",
        label: "Copy Path",
        icon: <Copy size={14} />,
        disabled: !hasPath,
        disabledReason: "This directory entry is not linked to a filesystem path.",
        onSelect: () => { void copyDirectoryPath(directory); },
      },
      {
        key: "rename",
        label: "Rename Directory Entry",
        icon: <Edit3 size={14} />,
        separatorBefore: true,
        onSelect: () => renameDirectory(directory.id),
      },
      {
        key: "create-board",
        label: "Create Board",
        icon: <Plus size={14} />,
        onSelect: () => {
          setDirectoryId(directory.id);
          setCreateOpen(true);
        },
      },
      {
        key: "remove",
        label: "Remove from Relay",
        icon: <X size={14} />,
        separatorBefore: true,
        danger: true,
        onSelect: () => requestRemoveDirectory(directory.id),
      },
    ];
  }

  function toggleDirectoryExpanded(targetDirectoryId: string) {
    setExpandedDirectoryIds((current) => {
      const next = new Set(current);
      if (next.has(targetDirectoryId)) next.delete(targetDirectoryId);
      else next.add(targetDirectoryId);
      return next;
    });
  }

  function expandDirectory(targetDirectoryId: string) {
    setExpandedDirectoryIds((current) => {
      if (current.has(targetDirectoryId)) return current;
      const next = new Set(current);
      next.add(targetDirectoryId);
      return next;
    });
  }

  function selectBoard(boardId: string, nextView: RelayView = settings.defaultView) {
    const board = data.boards.find((candidate) => candidate.id === boardId);
    if (board !== undefined) expandDirectory(board.directoryId);
    setSelectedBoardId(boardId);
    setWorkspaceTab("dashboard");
    setView(nextView);
  }

  function openDirectoryContextMenu(targetDirectoryId: string, x: number, y: number) {
    setDirectoryMenu({ directoryId: targetDirectoryId, x, y });
  }

  if (!storeReady) {
    return <div className="app-loading"><LogoMark /><span>Opening local workspace...</span></div>;
  }

  if (storeError !== null) {
    return (
      <div className="app-loading app-loading-error">
        <LogoMark />
        <span>Could not open local workspace.</span>
        <p>{storeError}</p>
        {storagePath !== null && <code>{storagePath}</code>}
      </div>
    );
  }

  return (
    <div className={cx("relay-background", `theme-${settings.appearance}`, `density-${settings.density}`, settings.performanceMode && "performance-mode", settings.reduceMotion && "reduce-motion", settings.compactCards && "compact-cards")}>
      <div className="app-window">
        <header className="topbar">
          <button className="mobile-menu" type="button" onClick={() => setSidebarOpen((open) => !open)} aria-label="Toggle navigation"><Menu size={19} /></button>
          <button className="brand" type="button" onClick={() => { setSelectedBoardId(null); setView("board"); }}><LogoMark /><span>Relay</span></button>
          <label className="global-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search boards..." /></label>
          <div className="topbar-actions">
            <button className="donate-button" type="button" onClick={() => setDonateOpen(true)}><HeartHandshake size={16} /> Donate</button>
          </div>
        </header>

        <div className="app-body">
          <aside className={cx("sidebar", sidebarOpen && "open")}>
            <div className="workspace-switcher"><span className="workspace-avatar">R</span><div><strong>Relay</strong><small>On This Device</small></div></div>
            <nav className="main-nav" aria-label="Workspace">
              <button className={cx(selectedBoardId === null && directoryId === "all" && "active")} type="button" onClick={() => { setSelectedBoardId(null); setDirectoryId("all"); setSidebarOpen(false); }}><LayoutDashboard size={17} /> Overview</button>
            </nav>
            <div className="sidebar-section-heading"><span>Directories</span><button type="button" onClick={() => setCreateOpen(true)} aria-label="Create Board"><Plus size={14} /></button></div>
            <nav className="directory-nav" aria-label="Directories">
              {data.directories.map((directory) => {
                const directoryBoards = boardsByDirectory.get(directory.id) ?? [];
                const count = directoryBoards.length;
                const expanded = expandedDirectoryIds.has(directory.id);
                const boardListId = `directory-${directory.id}-boards`;
                return (
                  <div className="directory-menu" key={directory.id}>
                    <div
                      className={cx("directory-summary", selectedBoardId === null && directoryId === directory.id && "active")}
                      title={directory.path ?? directory.name}
                      onMouseDownCapture={(event) => {
                        if (event.button !== 2) return;
                        event.preventDefault();
                        event.stopPropagation();
                        openDirectoryContextMenu(directory.id, event.clientX, event.clientY);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openDirectoryContextMenu(directory.id, event.clientX, event.clientY);
                      }}
                    >
                      <button
                        className="directory-summary-main"
                        type="button"
                        onClick={() => {
                          setSelectedBoardId(null);
                          setDirectoryId(directory.id);
                        }}
                      >
                        <Folder size={16} /><span>{directory.name}</span>
                      </button>
                      <b>{count}</b>
                      <button
                        className="directory-expand-toggle"
                        type="button"
                        aria-label={`${expanded ? "Collapse" : "Expand"} ${directory.name}`}
                        aria-controls={boardListId}
                        aria-expanded={expanded}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleDirectoryExpanded(directory.id);
                        }}
                      >
                        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                    </div>
                    {expanded && <div className="directory-board-list" id={boardListId}>
                      {directoryBoards.map((board) => (
                        <button key={board.id} className={cx(selectedBoardId === board.id && "active")} type="button" onClick={() => {
                          selectBoard(board.id);
                          setSidebarOpen(false);
                        }}>{board.name}</button>
                      ))}
                      {directoryBoards.length === 0 && <span>No Boards</span>}
                    </div>}
                  </div>
                );
              })}
            </nav>
            <div className="sidebar-spacer" />
            <UserMenu
              settings={settings}
              storagePath={storagePath}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenStorage={openStorage}
            />
          </aside>

          <div className="workspace-area">
            {selectedBoard === undefined && workspaceTab === "discovery" && discoveryDirectoryPath ? (
              <main className="board-workspace">
                <header className="board-header">
                  <div className="board-title-row">
                    <button className="icon-button" type="button" onClick={() => setWorkspaceTab("dashboard")} aria-label="Back to dashboard"><ArrowLeft size={18} /></button>
                    <div className="board-title-icon"><Search size={19} /></div>
                    <div><span className="eyebrow">{discoveryDirectoryPath}</span><h1>Project Discovery</h1></div>
                  </div>
                </header>
                <div className="view-content">
                  <DiscoveryView
                    repoPath={discoveryDirectoryPath}
                    discovery={data.discoveries?.[discoveryDirectoryPath]}
                    onDiscoveryUpdate={(updated) => {
                      setWorkspace((current) => ({
                        ...current,
                        discoveries: { ...current.discoveries, [discoveryDirectoryPath]: updated },
                      }));
                    }}
                  />
                </div>
              </main>
            ) : selectedBoard === undefined ? (
              <Dashboard
                data={data}
                directoryId={directoryId}
                settings={settings}
                search={deferredSearch}
                storagePath={storagePath}
                onArchiveBoard={toggleBoardArchived}
                onDeleteBoard={requestDeleteBoard}
                onGitBoard={setGitBoardId}
                onRenameBoard={renameBoard}
                onOpenStorage={openStorage}
                onOpenBoard={(boardId) => startTransition(() => selectBoard(boardId))}
                onCreateBoard={() => setCreateOpen(true)}
                onOpenDiscovery={() => {
                  const dir = data.directories.find((item) => item.id === directoryId);
                  if (dir?.path) { setDiscoveryDirectoryPath(dir.path); setWorkspaceTab("discovery"); }
                }}
              />
            ) : (
              <main className="board-workspace">
                <header className="board-header">
                  <div className="board-title-row">
                    <button className="icon-button" type="button" onClick={() => { setSelectedBoardId(null); setWorkspaceTab("dashboard"); }} aria-label="Back to dashboard"><ArrowLeft size={18} /></button>
                    <div className="board-title-icon"><Code2 size={19} /></div>
                    <div><span className="eyebrow">{selectedBoard.repository}</span><button className="board-name-button" type="button" onClick={() => renameBoard(selectedBoard.id)} aria-label={`Rename ${selectedBoard.name}`}><h1>{selectedBoard.name}</h1><Edit3 size={13} /></button></div>
                    <span className="phase-pill"><i /> {selectedBoard.currentPhase}</span>
                  </div>
                  <button className="board-github-button board-header-git" type="button" onClick={() => setGitBoardId(selectedBoard.id)}><Github size={15} /> Git Commit</button>
                </header>
                <nav className="view-switcher" aria-label="Board views">
                  {views.map((item) => { const Icon = item.icon; return <button key={item.id} className={cx(view === item.id && "active")} type="button" onClick={() => startTransition(() => setView(item.id))}><Icon size={15} /> {item.label}{item.id === "context" && <span>{selectedBoard.context.length}</span>}</button>; })}
                  <button className={cx(view === "blockers" && "active", "mobile-extra-view")} type="button" onClick={() => setView("blockers")}><AlertTriangle size={15} /> Blockers</button>
                </nav>
                <div className="view-content">
                  {view === "board" && <BoardView board={selectedBoard} settings={settings} tagRegistry={tagRegistry} onMoveCard={moveCard} onDeleteCard={deleteCard} onDuplicateCard={duplicateCard} onArchiveCard={toggleCardArchived} onToggleCardBlocked={toggleCardBlocked} onAddCard={addCard} onAddGroup={addGroup} onAddColumn={addColumn} onDeleteColumn={deleteColumn} onRenameColumn={renameColumn} onReorderColumn={reorderColumn} onReorderGroups={reorderGroups} onCycleTagTone={cycleTagTone} onOpenCard={setSelectedCardId} />}
                  {view === "plan" && <PlanView key={selectedBoard.id} board={selectedBoard} onSave={(plan) => updateBoard(selectedBoard.id, (board) => ({ ...board, plan, lastActivity: now() }))} />}
                  {view === "timeline" && <TimelineView board={selectedBoard} onSavePhase={updatePhase} />}
                  {view === "context" && <ContextView board={selectedBoard} onAddContext={addContext} />}
                  {view === "decisions" && <DecisionsView board={selectedBoard} onAddDecision={addDecision} />}
                  {view === "activity" && <ActivityView board={selectedBoard} />}
                  {view === "blockers" && <BlockersView board={selectedBoard} />}
                  {view === "discovery" && (() => {
                    const repoPath = selectedBoard.repository !== "No repository" ? selectedBoard.repository : "";
                    return repoPath ? (
                      <DiscoveryView
                        repoPath={repoPath}
                        discovery={data.discoveries?.[repoPath]}
                        onDiscoveryUpdate={(updated) => {
                          setWorkspace((current) => ({
                            ...current,
                            discoveries: { ...current.discoveries, [repoPath]: updated },
                          }));
                        }}
                      />
                    ) : (
                      <div className="empty-state"><Search size={24} /><h3>No Repository Linked</h3><p>Link this board to a local project directory to enable code discovery.</p></div>
                    );
                  })()}
                </div>
              </main>
            )}
          </div>
        </div>
      </div>

      {createOpen && <CreateBoardModal directories={data.directories} onClose={() => setCreateOpen(false)} onCreate={(input) => {
        const id = crypto.randomUUID();
        const createdAt = now();
        const newDirectoryId = input.directoryId || crypto.randomUUID();
        const board: RelayBoard = { id, directoryId: newDirectoryId, name: input.name, description: input.description, repository: "No repository", currentPhase: "Planning", progress: 0, activeTasks: 0, blockers: 0, lastActivity: createdAt, owner: actorName, plan: input.plan, columns: defaultColumns, cards: [], phases: [{ id: crypto.randomUUID(), name: "Planning", objective: "", progress: 0, status: "in_progress" }], context: [], decisions: [], activity: [humanActivity({ action: "created board", target: input.name, tone: "green" }, createdAt)] };
        setWorkspace((current) => {
          const directory = input.directoryPath === undefined
            ? { id: newDirectoryId, name: input.directoryName }
            : { id: newDirectoryId, name: input.directoryName, path: input.directoryPath };
          return {
            directories: input.directoryId === "" ? [...current.directories, directory] : current.directories,
            boards: [...current.boards, board],
            tags: current.tags ?? [],
            settings: current.settings ?? defaultRelaySettings,
          };
        });
        expandDirectory(newDirectoryId);
        setCreateOpen(false); setSelectedBoardId(id); setView(input.plan === "" ? settings.defaultView : "plan");
      }} />}
      {donateOpen && <DonateModal onClose={() => setDonateOpen(false)} />}
      {settingsOpen && <WorkspaceSettingsModal settings={settings} storagePath={storagePath} viewOptions={views.map(({ id, label }) => ({ id, label }))} onOpenStorage={openStorage} onSettingsChange={updateSettings} onClose={() => setSettingsOpen(false)} />}
      <UpdatePopup />
      {gitBoard !== undefined && <GitCommitPanel boardId={gitBoard.id} boardName={gitBoard.name} onClose={() => setGitBoardId(null)} />}
      {selectedBoard !== undefined && selectedCard !== undefined && <CardDetail key={selectedCard.id} board={selectedBoard} card={selectedCard} tagRegistry={tagRegistry} onAddNote={addCardNote} onCycleTagTone={cycleTagTone} onClose={() => setSelectedCardId(null)} onSave={saveCard} />}
      {directoryMenu !== null && (() => {
        const directory = data.directories.find((candidate) => candidate.id === directoryMenu.directoryId);
        if (directory === undefined) return null;
        return (
          <ContextMenu
            label={`Actions for ${directory.name}`}
            position={{ x: directoryMenu.x, y: directoryMenu.y }}
            items={directoryContextItems(directory)}
            onClose={() => setDirectoryMenu(null)}
          />
        );
      })()}
      {textModal !== null && (() => {
        if (textModal.kind === "rename-board") {
          const board = data.boards.find((candidate) => candidate.id === textModal.boardId);
          if (board === undefined) return null;
          return (
            <TextFieldModal
              title="Rename Board"
              eyebrow="Board"
              label="Board Name"
              initialValue={board.name}
              submitLabel="Rename Board"
              validate={(value) => data.boards.some((candidate) => candidate.id !== board.id && candidate.name.trim().toLowerCase() === value.trim().toLowerCase()) ? "A board with this name already exists." : null}
              onCancel={() => setTextModal(null)}
              onSubmit={(value) => {
                renameBoardNow(board.id, value);
                setTextModal(null);
              }}
            />
          );
        }
        const directory = data.directories.find((candidate) => candidate.id === textModal.directoryId);
        if (directory === undefined) return null;
        return (
          <TextFieldModal
            title="Rename Directory Entry"
            eyebrow="Directory"
            label="Directory Name"
            initialValue={directory.name}
            submitLabel="Rename Directory"
            validate={(value) => data.directories.some((candidate) => candidate.id !== directory.id && candidate.name.trim().toLowerCase() === value.trim().toLowerCase()) ? "A directory entry with this name already exists." : null}
            onCancel={() => setTextModal(null)}
            onSubmit={(value) => {
              renameDirectoryNow(directory.id, value);
              setTextModal(null);
            }}
          />
        );
      })()}
      {confirmModal !== null && (() => {
        if (confirmModal.kind === "delete-board") {
          const board = data.boards.find((candidate) => candidate.id === confirmModal.boardId);
          if (board === undefined) return null;
          return (
            <ConfirmDialog
              title="Delete Board"
              message={`Delete "${board.name}" and all of its cards?`}
              detail="This removes the board from Relay local storage. This cannot be undone."
              confirmLabel="Delete Board"
              danger
              onCancel={() => setConfirmModal(null)}
              onConfirm={() => {
                deleteBoardNow(board.id);
                setConfirmModal(null);
              }}
            />
          );
        }
        if (confirmModal.kind === "delete-card") {
          const board = data.boards.find((candidate) => candidate.id === confirmModal.boardId);
          const card = board?.cards.find((candidate) => candidate.id === confirmModal.cardId);
          if (board === undefined || card === undefined) return null;
          return (
            <ConfirmDialog
              title="Delete Card"
              message={`Delete "${card.title}"?`}
              detail="This removes the card, notes, tags, and progress from the board."
              confirmLabel="Delete Card"
              danger
              onCancel={() => setConfirmModal(null)}
              onConfirm={() => {
                deleteCardNow(board.id, card.id);
                setConfirmModal(null);
              }}
            />
          );
        }
        const directory = data.directories.find((candidate) => candidate.id === confirmModal.directoryId);
        if (directory === undefined) return null;
        const boardCount = data.boards.filter((board) => board.directoryId === directory.id).length;
        return (
          <ConfirmDialog
            title="Remove Directory from Relay"
            message={`Remove "${directory.name}" from Relay?`}
            detail="Files on disk are not touched — this only removes the directory entry from Relay."
            confirmLabel="Remove from Relay"
            danger
            onCancel={() => setConfirmModal(null)}
            onConfirm={() => {
              removeDirectoryFromRelay(directory.id, boardCount === 0 ? "move" : directoryBoardAction);
              setConfirmModal(null);
            }}
          >
            {boardCount > 0 && (
              <fieldset className="confirm-dialog-choice">
                <legend>{boardCount} linked {boardCount === 1 ? "board" : "boards"} — what should happen to {boardCount === 1 ? "it" : "them"}?</legend>
                <label>
                  <input
                    type="radio"
                    name="directory-board-action"
                    value="move"
                    checked={directoryBoardAction === "move"}
                    onChange={() => setDirectoryBoardAction("move")}
                  />
                  Move to Unfiled
                </label>
                <label>
                  <input
                    type="radio"
                    name="directory-board-action"
                    value="delete"
                    checked={directoryBoardAction === "delete"}
                    onChange={() => setDirectoryBoardAction("delete")}
                  />
                  Delete {boardCount === 1 ? "the board" : "the boards"}
                </label>
              </fieldset>
            )}
          </ConfirmDialog>
        );
      })()}
      <ToastShelf toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}

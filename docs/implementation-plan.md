# Relay implementation plan

Status: In implementation  
Date: 2026-07-17  
Product: Relay - Development that remembers.

## 1. Planning outcome

Relay will be built as a local-first desktop development operating system rather
than a generic project manager or hosted website. The first release runs in an
Electron shell, starts with no sample data, and stores user-created project data
under the operating system's app-owned data directory. Remote sync and agent
integrations are later opt-in capabilities.

Done means a user can organize development initiatives into structured boards,
plan and execute work with evidence, preserve decisions and session handoffs,
and resume the correct work through Claude Code or Codex without reloading an
entire project history.

## 2. Repository baseline

The repository inspection on 2026-07-17 found:

- The target directory is empty.
- There is no Git repository.
- There are no project instruction files, manifests, source files, tests,
  database definitions, routes, authentication, styling, or planning system.
- There is no existing functionality or architecture to preserve.

This document is therefore the first planning artifact. The implementation
stage must initialize version control and scaffold the chosen architecture; it
must not imply that an existing application was audited.

## 3. Product principles

1. Development semantics come first. Boards, cards, phases, evidence,
   decisions, context, and handoffs are separate concepts with explicit rules.
2. Code state and project state have different authorities. The repository is
   authoritative for current code; Relay is authoritative for approved plans,
   task state, decisions, and recorded context.
3. Completion is evidence-based. Implementation complete, verified, shipped,
   and production verified are separate states.
4. Agent context is selected, not dumped. Context packets are bounded,
   explainable, and ranked for the current card.
5. All write paths are auditable. Human, API, CLI, and MCP mutations use the
   same application services and produce activity records.
6. Generated plans are proposals. AI output never silently overwrites accepted
   plans, phases, cards, or decisions.
7. The standalone application owns the domain. Integrations are clients, not
   alternate business-logic implementations.
8. Multi-user and multi-agent safety is designed in from the first schema.
9. Accessibility and responsive alternatives are part of feature completion,
   not a final cosmetic pass.
10. Hidden model reasoning is never requested or stored. Relay stores concise
    engineering rationale and evidence only.
11. Local data is real data. Empty states remain empty until the user creates
    records; the application never fabricates projects, sessions, activity, or
    health metrics.
12. Relay is light-mode first and fills its native window without a decorative
    website frame.

## 4. Proposed architecture

### 4.1 Repository layout

Use a TypeScript monorepo managed by pnpm workspaces and Turborepo.

```text
relay/
  apps/
    desktop/              Electron main process, preload bridge, local storage
    web/                  Static Next.js renderer embedded in Electron
    api/                  Optional future sync and agent API
    worker/               Durable jobs, indexing, and generation
  packages/
    domain/               Entities, policies, ranking, and state machines
    contracts/            Zod request/response schemas and API errors
    database/             Drizzle schema, migrations, and repositories
    auth/                 Better Auth configuration and authorization policies
    ui/                   Relay design system and accessible primitives
    observability/        Logging, tracing, metrics, and audit helpers
    testkit/              Fixtures, factories, and integration harnesses
    config/               Shared TypeScript, lint, and test configuration
  integrations/
    cli/                  The relay command-line client
    mcp/                  Local stdio and remote Streamable HTTP MCP server
    claude-code/          Claude Code plugin, skill, hooks, and installer
    codex/                Codex plugin, skill, hooks, and installer
  docs/
    decisions/            Architecture and product decision records
    implementation-plan.md
  infra/                  Local containers and deployment definitions
```

The Electron main process owns local files. The renderer receives only narrow,
typed operations through a context-isolated preload bridge and has no Node.js
access. The optional API, worker, CLI, and MCP server may import `domain`,
`contracts`, and database abstractions. Integrations must call a supported API
or shared client SDK and must never access PostgreSQL directly.

### 4.2 Runtime choices

| Concern | Choice | Reason |
| --- | --- | --- |
| Desktop | Electron with context isolation, renderer sandboxing, and a narrow preload bridge | Produces an installable cross-platform application while preserving the existing TypeScript renderer. |
| Renderer | Static Next.js App Router output with React and TypeScript | Reuses the component model without running or exposing a web server in the packaged app. |
| Local persistence | Atomic JSON writes under Electron `userData` | Provides real app-owned offline persistence without a server, account, or seeded database. |
| Optional API | Fastify with OpenAPI generated from shared Zod contracts | A future agent and sync boundary independent of the desktop renderer. |
| Optional database | PostgreSQL with Drizzle ORM and checked-in SQL migrations | Supports later collaborative sync without becoming a requirement for local desktop use. |
| Authentication | Better Auth with organization and API-key capabilities | Workspace membership and revocable, scoped machine credentials without building credential handling from scratch. |
| Jobs | A PostgreSQL-backed durable job queue | Avoids mandatory Redis infrastructure while supporting retries, leases, and scheduled cleanup. |
| Realtime | Server-Sent Events for board activity and active-session updates | Relay updates are primarily server-to-client; SSE is simpler than bidirectional sockets and avoids polling. |
| Search | PostgreSQL full-text search plus trigram indexes | Covers the first release without an external search cluster. |
| Files | S3-compatible object storage with signed uploads | Keeps attachments and scenic backgrounds out of the application database. |
| Testing | Vitest, Testing Library, Playwright, and API/database integration tests | Covers pure domain behavior, UI behavior, contracts, persistence, and critical user flows. |
| Observability | Structured logs, OpenTelemetry traces, error reporting, and health endpoints | Required to diagnose failed jobs, integrations, and concurrent writes. |

Exact dependency versions will be pinned when Stage 1A starts, after checking
current release notes and runtime compatibility. No dependency will be selected
solely because it is listed here if its current security or maintenance posture
has materially changed.

### 4.3 Distribution topology

The initial product is a signed desktop application containing the Electron
main process, preload bridge, and exported static renderer. It requires no web
service, account, PostgreSQL instance, or object storage. Optional sync and
agent services remain separate future processes so adding them does not weaken
the local application boundary.

### 4.4 Domain and audit model

Use transactional mutable tables for current state and an append-only activity
log for history. Relay will not use event sourcing as the primary persistence
model.

Every meaningful mutation follows one application-service transaction:

1. Authenticate the actor.
2. Authorize the actor against the specific workspace and resource.
3. Validate the command and expected entity version.
4. Update domain state.
5. Append an activity event with safe before/after metadata.
6. Append an outbox record for realtime delivery and derived indexing.
7. Commit atomically.

The activity log is append-only to normal users. Privacy or legal deletion is a
separate privileged workflow that records a redaction tombstone rather than
silently rewriting history.

### 4.5 Concurrency model

- Relay uses optimistic locking for collaborative edits rather than holding
  long-lived database locks across user or agent work.
- Mutable collaborative entities have an integer `version` field.
- API mutations require `expectedVersion` or an `If-Match` value where a stale
  write could overwrite user work.
- Stale updates return a typed `409 conflict` response with the current version
  and enough metadata for the UI to refresh or present a merge choice.
- Agent create and mutation operations accept an idempotency key.
- Unique database constraints close check-then-create races.
- Card and column ordering uses sortable rank keys with transactional rebalance.
- Card claims use a renewable lease with `claimedBy`, `claimedAt`, and
  `expiresAt`; they are not permanent locks.
- Plan autosave uses monotonically increasing client sequence numbers and aborts
  superseded requests so late responses cannot replace newer text.
- Outbox workers use lease-based at-least-once processing, so downstream
  handlers must be idempotent.

### 4.6 Security model

- Browser users authenticate through secure, HTTP-only, same-site cookies.
- Agent and CLI access uses revocable hashed tokens with explicit workspace,
  board, and operation scopes.
- Authorization is checked per object on every endpoint. Client-supplied actor,
  workspace, or role values are never trusted.
- Markdown and model output are untrusted. Raw HTML is disabled and rendered
  output is sanitized.
- Imported plans, issue text, repository content, and attachments are marked as
  untrusted data and never treated as agent instructions.
- Uploads use type and size allowlists, signed URLs, malware-scanning hooks, and
  private-by-default object access.
- Server-side URL imports use scheme and host validation plus network egress
  restrictions to prevent SSRF.
- Secrets remain in environment or managed secret storage and are redacted from
  logs, errors, session commands, and activity metadata.
- Destructive actions require a confirmation intent recorded by the server.
- Rate limits apply independently to sessions, human writes, agent tokens,
  generation, imports, search, and uploads.
- Token creation displays the secret once; only a hash and safe prefix are
  persisted.

## 5. Core domain model

All primary records use opaque UUIDv7 identifiers, UTC timestamps, and explicit
created-by/updated-by actor references.

### 5.1 Tenancy and organization

- `users`
- `sessions` and authentication-provider tables
- `workspaces`
- `workspace_members` with owner, admin, member, and viewer roles
- `directories` with parent, rank, archive timestamp, and workspace ownership
- `board_permissions` for optional board-specific restrictions
- `agent_tokens` with hash, prefix, scopes, expiry, last use, and revocation

Directories are organizational folders, not security boundaries. Authorization
is inherited from the workspace unless a board has a stricter permission rule.

### 5.2 Boards and planning

- `boards`
- `board_columns`
- `board_views`
- `plan_documents`
- `plan_versions`
- `plan_locked_sections`
- `phases`
- `milestones`
- `phase_dependencies`

A board has exactly one active detailed plan document and any number of
immutable plan versions. Autosave updates the draft; explicit saves,
generation applications, and restores create versions. Restoring creates a new
version rather than deleting later history.

### 5.3 Work items

- `cards`
- `card_dependencies`
- `card_children`
- `card_tags` and `tags`
- `checklist_items`
- `acceptance_criteria`
- `card_file_links`
- `card_git_links`
- `comments`
- `attachments`
- `completion_requirements`
- `completion_evidence`

Supported card types are feature, task, bug, refactor, research, test,
documentation, security, decision, release, and technical debt. Card fields
include status, priority, urgency, phase, milestone, tags, human or agent owner,
complexity, estimated and actual effort, dates, hierarchy, dependencies,
review status, deployment status, and all links and notes named above.

Card status is driven by board-column behavior, while evidence checkpoints are
independent records. Relay must not collapse them into one linear status. The
initial checkpoints are:

```text
work started
code changed
implementation claimed complete
tests written
tests passed
acceptance criteria satisfied
review completed
human verified
deployed
production verified
```

Implementation complete, verified, shipped, and production verified are derived
labels based on the card's configured requirements and recorded checkpoints.
Failed or invalidated evidence removes the derived label with an activity record
and explanation. Column movement alone never creates evidence.

### 5.4 Memory and execution

- `context_items` and `context_revisions`
- `context_relationships`
- `decisions` and `decision_revisions`
- `decision_relationships`
- `blockers`
- `work_sessions`
- `session_updates`
- `handoffs`
- `card_claims`
- `activity_events`
- `outbox_events`

Context and decisions are versioned. Superseding creates an explicit relation;
it does not overwrite the prior record. Sessions distinguish Relay work
sessions from browser authentication sessions.

Work sessions record the original objective, meaningful work performed, files
changed, commands executed with secret redaction, tests and results, decisions,
discoveries, blockers, errors, card changes, remaining work, and recommended
next action. They do not require noisy recording of every trivial shell command.

### 5.5 Repository and integration

- `repository_connections`
- `repository_match_rules`
- `branches`
- `commits`
- `pull_requests`
- `agent_installations`
- `integration_health_events`

Repository identity uses provider, canonical remote URL, and optional local
repository fingerprint. A local path is a device-specific hint and cannot be
the sole board identity.

### 5.6 Intelligence and proposals

- `generation_jobs`
- `generated_proposals`
- `proposal_items`
- `proposal_conflicts`
- `context_packets`
- `task_recommendations`

Generated output is schema-validated, stored as a proposal, diffed against the
current board, and applied in a transaction only after approval. Proposal items
can be accepted, edited, merged, or rejected independently.

## 6. API and integration contracts

### 6.1 HTTP contract

- Version all public endpoints under `/v1`.
- Publish generated OpenAPI and a generated TypeScript client.
- Use stable error codes such as `RELAY_NOT_FOUND`, `RELAY_FORBIDDEN`,
  `RELAY_VERSION_CONFLICT`, and `RELAY_BLOCKED` rather than matching error text.
- Use cursor pagination for activity, sessions, cards, and search.
- Use request IDs and actor IDs in logs, but never include token values.
- Mutations accept idempotency keys and return the resulting activity ID.
- API changes are additive by default. Breaking changes require a new API
  version and a migration path for CLI, MCP, and installed plugins.

### 6.2 MCP contract

The MCP server exposes workflow-level tools backed by the same application
services as HTTP. Tool metadata accurately marks read-only, destructive, and
open-world behavior.

Initial tool groups:

- Project: identify project, get board, get summary, connect repository.
- Planning: get plan, propose plan, update plan, create phase, create card.
- Execution: get next tasks, start card, record progress, link files, link Git.
- Memory: get context, record discovery, get decisions, record decision.
- Evidence: record tests, complete implementation, verify, ship.
- Sessions: start session, create handoff, finish session.

Responses return compact structured data plus a short model-readable summary.
Large records use pagination or explicit detail tools.

### 6.3 Context packet policy

Context selection is deterministic before optional model summarization. It
ranks records using:

- Direct relationship to the selected card.
- Current phase and dependency relevance.
- Accepted decision status.
- Active blocker state.
- Recency and confidence.
- File and module overlap.
- Latest handoff and incomplete session.
- Explicit `must not undo` importance.

Each packet includes source IDs, update timestamps, and an estimated token
size. Default packets target a small configurable budget. Truncation removes
low-ranked items, not acceptance criteria or active blockers. The agent can
retrieve omitted details explicitly.

### 6.4 Next-task ranking

The first implementation is a transparent deterministic scoring engine, not an
opaque model call. It excludes blocked and unsatisfied-dependency cards, then
scores priority, urgency, phase fit, critical-path impact, release impact,
existing progress, ownership, and context readiness. Complexity is used as a
capacity consideration, not as fake duration certainty.

The API returns a factor-by-factor explanation and what each recommendation
unblocks. An optional AI explanation may rewrite the text but cannot change the
rank without recording a separate proposal.

## 7. Web application map

### 7.1 Primary routes

```text
/sign-in
/onboarding
/w/:workspaceSlug
/w/:workspaceSlug/settings
/w/:workspaceSlug/d/:directoryId
/w/:workspaceSlug/b/:boardId/board
/w/:workspaceSlug/b/:boardId/plan
/w/:workspaceSlug/b/:boardId/timeline
/w/:workspaceSlug/b/:boardId/context
/w/:workspaceSlug/b/:boardId/activity
/w/:workspaceSlug/b/:boardId/decisions
/w/:workspaceSlug/b/:boardId/blockers
/w/:workspaceSlug/b/:boardId/sessions
```

Board detail opens as a URL-addressable side panel so deep links, browser
history, and keyboard navigation work without abandoning the board.

### 7.2 Dashboard

- Elevated application shell with directory navigation and workspace switcher.
- Global search, activity notifications, user menu, and settings.
- Directory create, rename, rank, archive, restore, and confirmed delete.
- Board cards with phase, estimated progress, active work, blockers, activity,
  owner, and repository status.
- A large create-board card opening a validated creation flow.
- Creation modes for blank, pasted plan, imported Markdown, generated plan,
  GitHub import, repository analysis, and template.
- Recent activity including active agent sessions, new blockers, completed
  tasks, and plans awaiting approval.
- A deterministic Continue Working section with the best next card and reason.

### 7.3 Board views

- Board: add, rename, reorder, collapse, archive, and configure columns; move
  cards with drag-and-drop plus keyboard and menu alternatives.
- Plan: large Markdown editor, version history, section locks, analysis, and
  proposal review.
- Timeline: phases, milestones, dependencies, exit criteria, and estimated
  critical path.
- Context: categorized, filterable, versioned memory records.
- Activity: searchable, chronological audit history.
- Decisions: structured decision log and supersession links.
- Blockers: active, resolved, owner, impact, and linked work.
- Sessions: session details, evidence, and concise handoffs.

### 7.4 Visual direction

The interface will translate the reference image into a refined desktop utility
rather than clone its controls:

- An edge-to-edge light desktop shell integrated with the native title bar,
  without an outer website frame or decorative green border.
- Elevated white content panels with large radii, fine neutral borders, and
  restrained layered shadows inside the application workspace.
- Instrument Sans for interface text and IBM Plex Mono for compact technical
  metadata, subject to final licensing and rendering checks.
- A controlled blue accent, warm neutral surfaces, and restrained semantic
  colors paired with labels or icons.
- Segmented board-view navigation, grouped panels, compact icon wells, and
  decisive full-width actions where appropriate.
- Purposeful motion for shell entry, panel transitions, proposal application,
  and card movement, with reduced-motion equivalents.
- Light mode first. Dark mode is deferred until it can be implemented as a
  complete, explicit user preference.

The design system will define color, typography, spacing, radius, shadow,
motion, focus, density, and z-index tokens before feature pages proliferate.

## 8. Delivery stages

Every stage ends with a report containing behavior delivered, rationale, files
changed, tests run, results, discoveries, decisions, remaining work, and the
recommended next stage.

### Stage 0 - Foundation decisions and repository bootstrap

Deliverables:

- Initialize Git and the pnpm/Turborepo workspace.
- Add root instructions, README, contribution workflow, environment example,
  decision-record template, and stage ledger.
- Record architecture decisions for service boundaries, persistence, auth,
  audit, concurrency, realtime, and proposal handling.
- Pin runtime and dependency versions after compatibility review.
- Configure strict TypeScript, linting, formatting, tests, commit checks, and CI.
- Add local PostgreSQL/object-storage containers and health scripts.

Verification:

- Fresh clone setup succeeds from the documented commands.
- Build, typecheck, lint, unit tests, and formatting checks run in CI.
- No secrets or developer-specific absolute paths are committed.

Exit gate: a new developer can bootstrap an empty environment and all empty
workspace gates pass.

### Stage 1A - Risk-first foundation vertical slice

Deliverables:

- Implement core ID, actor, version, authorization, error, and activity types.
- Configure PostgreSQL, migrations, Better Auth, workspace membership, and
  scoped API-key foundations.
- Build `/v1` API conventions and generated OpenAPI client.
- Prove one vertical slice: create workspace, directory, board, column, and card
  through authorized APIs while recording activity and outbox events.
- Add SSE delivery for the vertical-slice activity stream.
- Establish unit, API, real-database, and browser test harnesses.

Verification:

- Unauthorized cross-workspace access is rejected.
- A domain update and its activity/outbox records commit atomically.
- Duplicate idempotency keys return the original result, not duplicate records.
- Two stale writers produce one success and one typed conflict.
- The browser receives the committed activity without polling.

Exit gate: the riskiest shared path - auth to API to transaction to audit to
realtime UI - works end to end before broad feature work begins.

### Stage 1B - Workspace, directories, and dashboard

Deliverables:

- Build the Relay shell and design tokens in light and dark themes.
- Implement workspace selection and directory CRUD, ordering, archive, restore,
  and confirmed deletion.
- Implement board grid, board metadata, recent activity, and Continue Working.
- Implement create-board modal for blank and pasted-plan flows; other creation
  sources appear only when their handlers are functional.
- Add background selection, disablement, and signed user uploads.

Verification:

- Directory and board flows pass desktop, tablet, and mobile browser tests.
- Keyboard navigation and focus order pass automated and manual checks.
- Empty, loading, permission, offline, and error states are exercised.
- No dashboard statistic or control is disconnected or hardcoded.

Exit gate: users can organize and reopen real boards from a polished dashboard.

### Stage 1C - Boards, cards, and evidence

Deliverables:

- Implement configurable columns, rank ordering, collapse, status behavior, and
  saved views, including archive and restore behavior.
- Implement cards, types, priority, urgency, tags, ownership, dates, effort,
  hierarchy, dependencies, checklists, criteria, file/Git links, and comments.
- Implement side-panel detail routing and responsive full-screen fallback.
- Implement pointer drag-and-drop plus keyboard and mobile move alternatives.
- Implement claims, overlap warnings, evidence requirements, test records, and
  completion/verification/shipping state machines.
- Implement board search, filters, and grouping.

Verification:

- Concurrent reorder and edit cases do not silently lose state.
- Dependency cycles and invalid parent relationships are rejected.
- Column movement cannot bypass completion evidence rules.
- Critical card creation, edit, move, block, complete, and verify flows pass
  Playwright tests at desktop and mobile breakpoints.

Exit gate: Relay functions as a rigorous development board without planning or
AI shortcuts.

### Stage 1D - Detailed plans, phases, and proposals

Deliverables:

- Implement the Markdown plan editor, autosave, explicit versions, restore,
  full-screen mode, attachments, and safe preview.
- Implement locked plan sections and permission-aware editing.
- Implement phases, milestones, dependencies, risks, exit criteria, weighted
  progress estimation, and timeline visualization.
- Implement proposal storage, diff review, selective approval, editing, merge,
  rejection, conflict detection, and atomic application.
- Implement plan-to-phase/card generation through a provider adapter with
  schema-constrained output.
- Implement compare-to-board and missing-work analysis as proposals.

Verification:

- Late autosave responses cannot replace newer content.
- Version restore preserves all intervening history.
- Model output containing HTML, instructions, unknown fields, or invalid
  dependencies is sanitized or rejected.
- Applying a proposal never overwrites post-generation user edits silently.
- Progress is labeled estimated and changes with complexity, criteria,
  evidence, dependencies, and blockers rather than card count alone.

Exit gate: a pasted detailed plan can safely produce an editable proposal and
the user can selectively apply it to a real board.

### Stage 1E - Context, decisions, blockers, sessions, and audit

Deliverables:

- Implement categorized context with confidence, status, revisions, source,
  relations, file links, and supersession.
- Implement decisions with alternatives, consequences, scope, status, and
  supersession.
- Implement blocker lifecycle and affected-work relationships.
- Implement human and agent work sessions, meaningful progress updates,
  evidence, and structured handoffs.
- Complete activity filtering, target history, safe diffs, and audit export.
- Implement repository-state discrepancy records and authorized corrections.

Verification:

- Superseded records remain visible and are excluded from active context by
  default.
- Session close produces a compact handoff without storing hidden reasoning.
- Audit records identify actor, source, target, session, and safe value changes.
- Stale Relay state can be corrected without erasing the original claim.

Exit gate: a new human can understand what happened, why, what remains, and
what not to undo without reading complete chat histories.

### Stage 1F - Search and intelligence

Deliverables:

- Implement global and board search across the specified resource types.
- Implement missing-evidence and failing-test filters.
- Implement deterministic next-task ranking and factor explanations.
- Implement context packet ranking, token budgeting, provenance, and caching.
- Add optional model-assisted plan cleanup, expansion, and explanation adapters.
- Implement Markdown, GitHub issue, template, and authorized repository-analysis
  board creation flows.

Verification:

- Ranking fixtures prove blockers and unmet dependencies are excluded.
- Every recommendation exposes its score factors and unblocked work.
- Context packet fixtures prove active criteria, blockers, accepted decisions,
  and latest handoff survive budget pressure.
- Search permission tests prove inaccessible workspaces never leak through
  results, snippets, counts, or timing-sensitive shortcuts.
- Generation failures preserve user input and can be retried idempotently.

Exit gate: Relay can explain the next actionable card and supply a bounded,
relevant context packet from real board state.

### Stage 1G - Standalone hardening and release gate

Deliverables:

- Complete responsive layouts, accessibility, and reduced motion.
- Add performance budgets, query analysis, pagination, caching, and load tests.
- Complete rate limits, upload scanning hooks, CSP, CSRF/CORS configuration,
  Markdown hardening, token rotation, and audit retention.
- Add backups, restore drill, migration rollback procedure, observability,
  runbooks, privacy controls, and integration health views.
- Run full browser, API, database, job, accessibility, and security test suites.

Verification:

- Primary flows meet agreed performance budgets using temporary test fixtures
  that never ship in the application data store.
- Accessibility testing includes automated checks and keyboard/screen-reader
  manual passes.
- Backup restore and expand/migrate/contract procedures are exercised.
- Threat-model review has no unresolved critical or high-severity findings.
- No primary action is a placeholder or disconnected.

Exit gate: the standalone Relay acceptance matrix is green. Stage 2 cannot
begin before this gate.

### Stage 2A - Integration foundation

Deliverables:

- Publish generated SDK, CLI, stdio MCP server, and remote Streamable HTTP MCP
  endpoint.
- Implement repository identification, explicit board linking, local config,
  token login/revocation, health checks, and offline behavior.
- Implement concise project status and context-packet commands.
- Provide cross-platform install, list/status, repair, and uninstall commands.

Verification:

- Fresh install, login, link, identify, status, unlink, revoke, and uninstall
  pass on macOS, Linux, and Windows runners where supported.
- Revoked or expired tokens fail closed without exposing board data.
- Unavailable Relay never blocks unrelated coding work.
- Installers preserve existing config and write recoverable backups before
  modifying user files.

Exit gate: an external client can safely identify a repository and retrieve a
focused context packet without agent-specific behavior.

### Stage 2B - Claude Code integration

Deliverables:

- Package a Claude Code plugin with a Relay skill and SessionStart hook.
- On session start, identify the repository and emit a concise context packet as
  additional context only when the repository is linked.
- Add explicit Relay status, connect, continue, start-card, handoff, and finish
  workflows.
- Show connection health without overwriting an existing custom status line.
- Provide safe installer, diagnostics, and uninstall behavior.

Verification:

- Test startup, resume, compact, unavailable service, unlinked repository,
  revoked token, and malformed config cases.
- The hook fails open for simple coding sessions and never prints secrets.
- A new session receives the latest approved handoff and not the full board.
- Uninstall removes only Relay-owned entries and files.

Exit gate: Claude Code automatically receives concise Relay context for linked
projects with no manual prompt.

### Stage 2C - Codex integration

Deliverables:

- Package a Codex plugin with skill, MCP configuration, and trusted
  plugin-bundled SessionStart hook.
- Use repository `AGENTS.md` only for small durable workflow guidance; live board
  state comes from the hook and MCP tools.
- Add the same status, connect, continue, execution, handoff, and diagnostics
  workflows as Claude Code without duplicating domain rules.
- Provide marketplace metadata, local development installation, and clean
  uninstall.

Verification:

- Test startup, resume, clear, compact, subagent context boundaries, unavailable
  service, unlinked repository, revoked token, and disabled hooks.
- Plugin hooks require explicit trust and use only Relay-owned writable data.
- The CLI, IDE, and desktop Codex surfaces see consistent MCP configuration.
- Uninstall preserves unrelated hooks, MCP servers, plugins, and instructions.

Exit gate: Codex automatically receives concise Relay context for linked
projects with no manual prompt.

### Stage 2D - Card-by-card agent execution

Deliverables:

- Implement start-card preflight, dependency/blocker checks, claims, session
  start, and relevant-context retrieval.
- Implement noise-controlled progress, decision, discovery, blocker, file,
  commit, pull-request, and test evidence recording.
- Implement completion preflight against every configured requirement.
- Implement concise automatic handoff and authorized move-to-next-card behavior.
- Implement overlap warnings by claimed cards and known file areas.

Verification:

- Agents cannot start blocked cards or verify cards without required evidence.
- Repeated tool calls are idempotent.
- Expired claims recover safely and active claims warn rather than globally
  blocking collaboration.
- Repository/Relay discrepancies stop automatic completion and produce a clear
  correction workflow.

Exit gate: a supported agent can execute a multi-card phase across fresh
sessions without losing state or repeating completed work.

### Stage 2E - Integration release gate

Deliverables:

- End-to-end fixtures for new project creation, existing project linking,
  context continuation, multi-session work, simultaneous agents, token
  revocation, service outage, repair, and uninstall.
- Security review of installers, local config, hooks, MCP, token storage,
  imported content, and tool annotations.
- Version compatibility matrix and upgrade/migration documentation.
- Public installation, troubleshooting, and data-handling documentation.

Verification:

- Run every integration scenario against a deployed staging Relay instance.
- Confirm no test requires a developer's existing global agent configuration.
- Confirm install and uninstall are reversible from written backups.
- Confirm old supported clients receive additive compatible API responses.

Exit gate: the complete final acceptance matrix is green on supported agents.

## 9. Acceptance traceability

| ID | Acceptance criterion | Primary stage | Required evidence |
| --- | --- | --- | --- |
| AC-01 | Manage workspaces and directories | 1B | API, authorization, and browser tests |
| AC-02 | Create multiple boards with a functional large plus action | 1B | Desktop/mobile browser flow |
| AC-03 | Use configurable Trello-style columns and cards | 1C | DnD, keyboard, mobile, and persistence tests |
| AC-04 | Store card metadata, dependencies, criteria, and evidence | 1C | Domain/API tests and card-detail flow |
| AC-05 | Keep completion, verification, shipping, and production verification separate | 1C | State-machine and authorization tests |
| AC-06 | Maintain detailed plan versions, locks, and restore | 1D | Autosave race and restore tests |
| AC-07 | Generate reviewable phases/cards from a pasted plan | 1D | Schema validation and proposal application tests |
| AC-08 | Track phases, milestones, dependencies, and estimated progress | 1D | Domain fixtures and timeline browser tests |
| AC-09 | Persist context, decisions, blockers, sessions, and handoffs | 1E | Revision, supersession, search, and session tests |
| AC-10 | Show searchable audit history of what happened and why | 1E | Atomic audit and filter tests |
| AC-11 | Recommend and explain the next actionable card | 1F | Deterministic ranking fixtures |
| AC-12 | Retrieve bounded, relevant context rather than full history | 1F | Token-budget and provenance fixtures |
| AC-13 | Import Markdown, GitHub, templates, and repository analysis | 1F | Authenticated import and failure-path tests |
| AC-14 | Meet visual, responsive, theme, motion, and accessibility quality | 1G | Visual regression, a11y, and manual review |
| AC-15 | Automatically activate in Claude Code for linked projects | 2B | Fresh-session integration tests |
| AC-16 | Automatically activate in Codex for linked projects | 2C | Fresh-session integration tests |
| AC-17 | Create a board from an approved substantial agent request | 2D | End-to-end approval and proposal test |
| AC-18 | Continue work from the actual repository and latest handoff | 2D | Multi-session discrepancy test |
| AC-19 | Update progress card by card with meaningful evidence | 2D | Agent workflow and noise-control tests |
| AC-20 | Support multiple agents without silent overwrite | 2D | Claim, lease, conflict, and overlap tests |
| AC-21 | Install, diagnose, repair, revoke, and uninstall safely | 2E | Cross-platform reversible install suite |
| AC-22 | Protect tenant data and untrusted imported content | 1G, 2E | Authorization, injection, SSRF, XSS, and scope tests |

## 10. Risk register

| Risk | Impact | Mitigation and early proof |
| --- | --- | --- |
| Scope expands into a generic project manager | High | Enforce development-specific domain language and acceptance matrix; defer unrelated PM features. |
| Domain model becomes an unmaintainable universal card table | High | Keep plan, phase, card, session, context, decision, blocker, and evidence entities distinct. |
| Agent writes bypass UI rules | Critical | Put all invariants in shared application services and test HTTP/MCP parity. |
| Concurrent autosave or agent sessions lose data | Critical | Prove version conflicts, idempotency, leases, and late-response handling in Stage 1A/1D. |
| Audit and current state diverge | High | Commit state, activity, and outbox in one transaction; reconcile in tests and monitoring. |
| AI generation corrupts accepted work | Critical | Store immutable proposals, validate schemas, compare versions, and require selective approval. |
| Context packets omit a critical constraint | High | Make mandatory categories non-droppable and include provenance plus on-demand retrieval. |
| Context packets become too large | High | Enforce budgets, deterministic ranks, compact summaries, and packet-size telemetry. |
| Permissions leak through search or activity | Critical | Centralize object authorization and test results, counts, snippets, SSE, and exports. |
| Hook outages block coding sessions | High | Keep session hooks time-bounded, read-only at startup, cached where safe, and fail open. |
| Installer damages existing global configuration | High | Parse supported config formats, perform targeted merges, validate, back up, list changes, and uninstall by ownership markers. |
| Git identity is ambiguous across clones/remotes | Medium | Use provider/canonical remote identity with explicit user selection and local fingerprints as hints only. |
| Rich editor creates data and XSS complexity | High | Keep Markdown canonical, raw HTML disabled, preview sanitized, and versions immutable. |
| Progress estimates imply false certainty | Medium | Label estimates, expose factors, avoid dates inferred only from card count, and allow manual targets. |
| Scenic UI harms readability or performance | Medium | Provide neutral fallback, overlays, responsive image sizing, user disablement, and contrast/performance budgets. |
| Early dependency choices age poorly | Medium | Pin after Stage 0 review, wrap external services behind adapters, and use additive migrations. |

## 11. Explicit non-goals for the first release

- Replacing Git hosting, pull-request review, CI, or deployment providers.
- Storing complete repository source in Relay by default.
- Autonomous remote board creation without prior user authorization.
- Capturing hidden chain-of-thought or complete raw agent transcripts.
- A general chat client or general-purpose document suite.
- Billing, marketplace monetization, enterprise SSO/SCIM, or native mobile apps.
- Exact duration promises generated from speculative effort estimates.
- Real-time collaborative character-by-character plan editing. Conflict-safe
  autosave and version restore are sufficient for the first release.

## 12. Open product choices

These choices do not block Stage 0 but must be resolved before the named stage:

- Stage 1B: whether boards may have independent permissions by default or only
  when explicitly restricted.
- Stage 1D: which hosted model providers ship in the first generation adapter
  and whether users supply their own provider credentials.
- Stage 1F: which Git provider is first; the plan assumes GitHub first with a
  provider abstraction.
- Stage 1G: target hosting provider, data region, retention defaults, and service
  level objectives.
- Stage 2A: whether the remote MCP endpoint uses OAuth at launch or begins with
  scoped bearer tokens while OAuth is completed.
- Stage 2D: default policy for automatically continuing to the next card after
  a verified completion.

Until changed, implementation should use the least destructive defaults:
workspace-inherited permissions, explicit provider credential setup, GitHub
first, configurable retention, short-lived scoped tokens, and user approval
before continuing to another card.

## 13. External architecture references

- Caveman installation and activation reference:
  https://github.com/JuliusBrussee/caveman
- Caveman installation behavior:
  https://github.com/JuliusBrussee/caveman/blob/main/INSTALL.md
- Claude Code hook development reference:
  https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/hook-development/SKILL.md
- Codex customization, plugins, hooks, and MCP documentation:
  https://developers.openai.com/codex/
- Next.js App Router documentation:
  https://nextjs.org/docs/app
- Better Auth organization and API-key documentation:
  https://better-auth.com/docs/plugins/organization
  https://better-auth.com/docs/plugins/api-key/reference

Relay copies Caveman's useful activation properties - agent-specific packaging,
session-start context, visible status, reversible installation, and fail-open
behavior - but not its behavioral prompt. Current Codex documentation supports
plugin-bundled hooks, SessionStart additional context, MCP servers, skills, and
repository `AGENTS.md`; live Relay state belongs in the hook/MCP path rather
than being written into a large static instruction file.

## 14. Stage report template

Each completed stage must add a report under `docs/stages/` with:

```text
Stage:
Status:
Acceptance criteria covered:
Behavior implemented:
Architecture rationale:
Files changed:
Migrations:
Tests and validation:
Observed results:
Security and accessibility checks:
Decisions recorded:
Discoveries and discrepancies:
Known limitations:
Remaining work:
Recommended next stage:
```

No stage is complete when required checks are skipped or failing. Skipped checks
must be named, explained, and left as blocking work rather than converted into a
completion claim.

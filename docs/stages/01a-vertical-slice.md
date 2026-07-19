# Stage 1A vertical slice report

Status: In progress  
Date: 2026-07-17

## Behavior implemented

- Typed contracts for boards, cards, evidence, and errors.
- Independent completion-evidence evaluation with invalidation.
- Explainable dependency-aware next-task ranking.
- Bounded context packet selection with provenance and token estimates.
- PostgreSQL schema and generated migration for 16 core tables.
- Reusable application service with atomic activity recording, idempotent
  creates, workspace isolation, and optimistic version conflicts.
- Fastify `/v1` routes for board and card creation, board state, and card moves.
- Responsive desktop renderer, dashboard, board, plan, timeline, context, decisions,
  activity, blockers, card drawer, and board creation flow.
- Electron desktop shell with sandboxing and a context-isolated preload bridge.
- Atomic, app-owned local persistence under Electron `userData`.
- Empty first-run state with no samples, fabricated sessions, or fake metrics.
- Light-first, edge-to-edge native window styling without the scenic border.

## Tests and validation

- 10 domain tests passed.
- 4 application-service tests passed.
- 3 API integration tests passed.
- Desktop storage-shape test passed.
- Workspace lint, typecheck, test, and production build passed.
- Static renderer export and native Electron assembly completed.
- Signed macOS app, DMG, and ZIP packages completed; the packaged renderer was
  launched and inspected through its Chromium debugging endpoint.
- Runtime inspection confirmed an empty store, active preload bridge, explicit
  light color scheme, full-width shell, and zero-pixel outer border.
- Running API created a board and card, moved the card, and returned a typed
  `409 RELAY_CONFLICT` for a stale repeated move.

## Decisions recorded

- Latest evidence record per checkpoint controls validity.
- Production builds publish source entrypoints without compiled tests.
- Development identity headers are rejected when `NODE_ENV=production`.

## Known limitations

- Local desktop data does not yet synchronize through the optional API.
- The generated PostgreSQL migration could not be applied because this machine
  has no PostgreSQL or Docker runtime.
- Better Auth and production object-level authorization are not connected yet.
- Browser screenshot tooling was unavailable, so visual pixel inspection and
  automated browser interaction remain unverified.
- AI generation, Git providers, CLI, MCP, Claude Code, and Codex integrations
  remain in later stages.

## Recommended next stage

Complete Stage 1A by implementing the PostgreSQL repository and Better Auth,
then connect the web data adapter to the `/v1` API before expanding Stage 1B.

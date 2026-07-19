# Stage 2 - Agent Integrations

Status: In progress  
Date: 2026-07-17

## Objective

Make long-running Relay work resumable across Claude Code, Codex, context resets, usage limits, crashes, and handoffs without loading full project history into every session.

## Phase 1 Foundation

Deliverables:

- Shared protocol and context schema.
- Repository identity and Git state.
- Long-task detection.
- Local configuration.
- Secret redaction and ignored-path policy.
- Local retry queue foundation.
- Compact session bootstrap.

Acceptance:

- Multi-phase/handoff-heavy requests are detected as tracked work.
- Tiny one-file fixes are rejected.
- Repository identity includes root, branch, remote, HEAD when available, dirty state, changed files, and staged files.
- Local checkpoints deduplicate by idempotency key.
- Secret-looking values are redacted before upload.
- Bootstrap output is compact and distinguishes disabled, unlinked, pending, and synced states.

Current evidence:

- `@relay/integration-core` created.
- Tests cover long-task detection, small-task rejection, repository identity, redaction, ignored paths, and queue idempotency.

## Phase 2 Claude Code Adapter

Deliverables:

- Claude Code plugin manifest.
- Relay skill.
- `SessionStart`, `PostToolUse`, `PreCompact`, and `SessionEnd` hooks.
- Development install docs.

Acceptance:

- Plugin loads with `--plugin-dir`.
- Startup hook emits compact Relay guidance for linked repos.
- Unlinked repos fail open with no server dependency.
- Checkpoint reminder is low-noise and does not spam every tool call.
- Session-end hook writes only local event metadata.

Current evidence:

- Initial plugin skeleton added in `integrations/claude-code`.

## Phase 3 Codex Adapter

Deliverables:

- Codex plugin manifest.
- Relay skill.
- Lifecycle hook JSON.
- MCP registration.
- Development install docs.

Acceptance:

- Hooks require user trust and fail open.
- Startup behavior matches Claude Code at user-facing level.
- Plugin preserves Codex-specific lifecycle and config constraints.
- MCP command exposes local Relay status and resume tools and remains replaceable by a future service-backed Stage 2A server.

Current evidence:

- Initial plugin skeleton added in `integrations/codex`.
- Local Codex MCP server exposes compact `relay_status` and `relay_resume` tools.

## Next Cards

1. Add integration API contracts for board lookup, bootstrap summary, checkpoint create, and sync status.
2. Implement service methods and API routes behind additive `/v1/integrations/*` endpoints.
3. Replace local-file MCP behavior with shared service-backed stdio MCP tools when integration API contracts land.
4. Add installer with dry-run, backup, duplicate detection, diagnostics, and uninstall.
5. Add cross-agent integration test: Claude starts, local checkpoint is queued, Codex resumes and verifies Git state.

## Risks

- Official hook APIs may differ by installed client version. Mitigation: validate plugin manifests and keep hook scripts fail-open.
- Codex plugin hooks require trust. Mitigation: clear diagnostics and install docs.
- Backend lacks auth and object-level authorization for agent tokens. Mitigation: no upload or remote mutation in initial hooks.
- Full automatic board creation needs plan generation and dedup endpoints. Mitigation: long-task detector lands first, creation flow follows after backend contracts.

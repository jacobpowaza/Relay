# 0003 Agent Integration Architecture

Status: Accepted  
Date: 2026-07-17

## Context

Relay needs Claude Code and Codex integrations that stay active across long development sessions and can resume work after context resets, usage limits, crashes, and cross-agent handoffs.

Repository inspection found a Stage 1A application with local board/card API basics, domain ranking/context helpers, and no `integrations/` implementation. The existing plan already reserves Stage 2A-2D for CLI/MCP/Claude/Codex/agent execution, but this request pulls the integration architecture forward.

Official extension-point findings:

- Claude Code plugins are self-contained directories with `.claude-plugin/plugin.json`; plugins may ship skills, hooks, MCP servers, settings, commands, agents, and bin entries.
- Claude Code hooks run at lifecycle events including `SessionStart`, `PostToolUse`, `PreCompact`, and `SessionEnd`; plugin hooks can add context and are configured in plugin manifests or `hooks.json`.
- Codex plugins can bundle skills, connectors, MCP tools, and lifecycle hooks. Plugin hooks are non-managed hooks and require user review/trust before running.
- Codex project config and hooks load from `.codex/` only when the project is trusted; user hooks are independent of project trust.
- The Caveman integration model uses plugin-bundled startup hooks to make behavior always active when users enable the plugin, rather than relying on users to repeat instructions each session.

## Decision

Build one shared integration core with thin agent adapters.

Shared core owns:

- Versioned protocol and context schema.
- Repository identity and Git state.
- Long-task detection.
- Board matching inputs.
- Session bootstrap shape.
- Checkpoint payload shape.
- Secret redaction and ignored-path policy.
- Local config and local retry queue primitives.

Claude Code adapter owns:

- `.claude-plugin/plugin.json`.
- Relay skill.
- `SessionStart`, `PostToolUse`, `PreCompact`, and `SessionEnd` hooks.
- Claude-specific install, diagnostics, and uninstall work.

Codex adapter owns:

- `.codex-plugin/plugin.json`.
- Relay skill.
- Codex hook JSON.
- Codex MCP registration.
- Codex-specific trust, install, diagnostics, and uninstall work.

Both adapters must use the same protocol records and checkpoint semantics. They may differ in lifecycle plumbing.

## Current Slice

This change adds:

- `@relay/integration-core` with protocol types, long-task detection, repository identity, secret redaction, config, bootstrap, and local queue.
- Claude Code plugin skeleton with startup and checkpoint-reminder hooks.
- Codex plugin skeleton with startup and checkpoint-reminder hooks plus local MCP status and resume tools.
- Tests for long-task detection, small-task rejection, repository identity, redaction, ignored paths, and queue idempotency.

The startup hooks only emit compact bootstrap context and fail open. They do not upload files, read source contents, or claim server synchronization.

## Missing Backend Endpoints

Stage 2A still needs service-backed endpoints/tools for:

- Board lookup by repository identity, remote URL, path, branch, and semantic request.
- Board create with original request, generated plan, phases, cards, dependencies, priorities, acceptance criteria, and next task.
- Plan version update without overwriting decision history.
- Task start/update/complete/block with optimistic versions and idempotency.
- Context search/get/append with metadata filters and bounded retrieval.
- Checkpoint create with compound implementation/test/Git summary.
- Handoff create.
- Sync status and offline queue replay.
- Agent-token authentication and object-level authorization.

## Consequences

Benefits:

- Claude Code and Codex stay behaviorally consistent without duplicate business rules.
- Extension-point risk is isolated to thin adapters.
- Startup context stays token-bounded.
- Offline operation has a local fallback path.

Costs:

- The first slice is not a complete production integration.
- Installer hardening remains a follow-up stage.
- Server/API work must become additive and versioned to protect future installed clients.

## Sources

- Claude Code hooks reference: lifecycle hooks, plugin hook locations, MCP tool hook naming, and events.
- Claude Code plugin docs: plugin manifest, skills, hooks, MCP server layout, and `--plugin-dir` testing.
- OpenAI Codex plugin docs: plugin-bundled hooks, hook trust, `PLUGIN_ROOT`, and `PLUGIN_DATA`.
- OpenAI Codex hooks/config docs: project/user hook loading, trusted project config, hook files.
- Julius Brussee Caveman: always-active startup hook pattern for Claude Code and Codex.

# Relay

Development that remembers.

Relay is a local-first desktop planning system for software work. It keeps
boards, detailed plans, tasks, decisions, activity, and project context in one
place so humans and AI coding agents can resume work without rebuilding the
same context every session.

Relay is not a hosted SaaS app. The first release runs inside Electron and
stores user data in the operating system's app-owned data directory.

## Screenshots

<p>
  <img src="docs/screenshots/relay-board.png" alt="Relay board view with filtered task cards and directory workflow controls" width="760">
</p>

The repository includes a docs-only example workspace at
`docs/examples/mock-workspace.json`. Relay does not seed this data
automatically; new installations start empty.

## What Relay Does

- Organize work into directories, linked projects, and boards.
- Plan work with phases, detailed plans, decisions, and important context.
- Track cards with status, priority, type, tags, notes, blockers, progress, and
  completion criteria.
- Record readable activity for meaningful human and agent actions.
- Review and commit Git changes from a built-in workbench: per-file diffs,
  split staged changes into multiple focused commits, a pre-commit review step
  that re-checks HEAD and each file before executing, and commit history with
  side-by-side comparison.
- Check for, download, and install app updates from an in-app update center
  backed by electron-updater, with manual check, skip-version, and
  install-and-restart controls.
- Persist local state through the Electron preload bridge, not browser-only
  storage.
- Resume linked projects through Codex and Claude Code integration scripts and
  hooks.
- Keep Claude/Codex as optional accelerators. Manual board, task, context,
  activity, directory, and settings workflows remain available in the app.

## Status

Relay is in active implementation. The local desktop flow, renderer, app-owned
persistence, manual board workflows, and local Codex/Claude integration scripts
are present. Hosted sync, account management, signed production installers, and
full release automation are still future work.

See `docs/implementation-plan.md` and `docs/stages/` for architecture,
delivery evidence, and remaining gates.

## Prerequisites

- Node.js 22 or newer
- pnpm 11
- macOS, Windows, or Linux for the Electron desktop shell

## Install

```bash
pnpm install
```

## Run The Desktop App

```bash
pnpm app:dev
```

Relay opens as a native desktop window. User-created directories, boards,
plans, cards, and activity are stored in:

```text
<Electron userData>/relay-data/workspace.json
```

On macOS development builds, this is typically under:

```text
~/Library/Application Support/Relay/relay-data/workspace.json
```

## Load Example Data

Relay intentionally starts empty. To preview a populated workspace, run the app
once, quit it, then copy the docs example into the local workspace path shown in
Settings:

```bash
mkdir -p "$HOME/Library/Application Support/Relay/relay-data"
cp docs/examples/mock-workspace.json "$HOME/Library/Application Support/Relay/relay-data/workspace.json"
pnpm app:dev
```

Use a disposable development profile when testing with mock data. This command
replaces the current local Relay workspace file.

## Codex Integration Smoke Test

Install the local Codex plugin while developing Relay:

```bash
codex plugin marketplace add "$PWD"
codex plugin add relay@relay-local
```

Start a new Codex thread after installing or reinstalling. Slash commands are
loaded when a thread starts. Use `/relay` for status/resume/checkpoint flows;
if your Codex build shows namespaced commands, use `/relay:relay`.

From any project directory:

```bash
printf 'Manual plugin smoke test\n\n- Verify Relay link\n' | node integrations/codex/scripts/relay-progress.mjs create-board --cwd "$PWD" --title "Relay Plugin Smoke Test"
node integrations/codex/scripts/relay-progress.mjs status --cwd "$PWD"
node integrations/codex/scripts/relay-progress.mjs resume --cwd "$PWD"
printf '{"cwd":"%s"}' "$PWD" | node integrations/codex/hooks/session-start.mjs
```

Expected result: the status and hook output show `[RELAY] Active` for a linked
project. Relay activity should update when a checkpoint is written:

```bash
printf '{"summary":"Smoke checkpoint from Codex","commands":["pnpm check"],"changedFiles":["apps/web/components/relay-app.tsx"],"progress":50}' | node integrations/codex/scripts/relay-progress.mjs checkpoint --cwd "$PWD"
```

## Claude Code Integration Smoke Test

From any project directory:

```bash
printf 'Manual plugin smoke test\n\n- Verify Relay link\n' | node integrations/claude-code/scripts/relay-progress.mjs create-board --cwd "$PWD" --title "Relay Claude Smoke Test"
node integrations/claude-code/scripts/relay-progress.mjs status --cwd "$PWD"
node integrations/claude-code/scripts/relay-progress.mjs resume --cwd "$PWD"
printf '{"cwd":"%s"}' "$PWD" | node integrations/claude-code/hooks/session-start.mjs
```

Expected result: the status and hook output show `[RELAY] Active` for a linked
project. Relay activity should update when a checkpoint is written:

```bash
printf '{"summary":"Smoke checkpoint from Claude","commands":["pnpm check"],"changedFiles":["apps/web/components/settings-modal.tsx"],"progress":65}' | node integrations/claude-code/scripts/relay-progress.mjs checkpoint --cwd "$PWD"
```

## Build

Build all packages:

```bash
pnpm build
```

Build an installable desktop package:

```bash
pnpm app:package
```

Generated package artifacts are ignored and should not be committed.

## Checks

```bash
pnpm check
```

This runs linting, TypeScript checks, tests, and production builds across the
workspace.

## Repository Layout

```text
apps/
  api/                  Optional future sync API
  desktop/              Electron main process, preload bridge, local storage
  web/                  Static Next.js renderer embedded in Electron
packages/
  application/          Application service layer
  contracts/            Shared schemas and API contracts
  database/             Optional server persistence package
  domain/               Domain rules, ranking, context, evidence
integrations/
  claude-code/          Claude Code plugin, hooks, and scripts
  codex/                Codex plugin, MCP server, hooks, and scripts
  core/                 Shared integration utilities
docs/
  decisions/            Architecture decision records
  examples/             Docs-only mock data
  screenshots/          README screenshots
  stages/               Stage reports and release evidence
```

## Data And Privacy

- Local desktop data is stored on the user's machine.
- Relay does not create sample boards or fake activity on a fresh install.
- Integration config is stored under `~/.relay/integrations/config.json`.
- Agent integrations record concise engineering evidence, not hidden reasoning.
- Claude and Codex integrations can be disabled from Relay settings or by
  setting `"enabled": false` in the integration config.

## License

Relay is licensed under AGPL-3.0. The canonical license file is maintained in
the GitHub repository.

<p align="center">
  <img src="apps/desktop/build/icon-1024.png" width="96" height="96" alt="Relay">
</p>

<h1 align="center">Relay</h1>
<p align="center"><em>Development that remembers.</em></p>

<p align="center">
  <a href="https://github.com/jacobpowaza/Relay/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License">
  </a>
  <a href="https://github.com/jacobpowaza/Relay/releases">
    <img src="https://img.shields.io/github/v/release/jacobpowaza/Relay?include_prereleases&label=release" alt="Release">
  </a>
  <a href="https://github.com/jacobpowaza/Relay/actions/workflows/ci.yml">
    <img src="https://github.com/jacobpowaza/Relay/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <img src="https://img.shields.io/badge/platform-macOS%20|%20Windows%20|%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/pnpm-11.10.0-orange" alt="pnpm">
</p>

Relay is a **local-first** desktop planning system for software work. It keeps
boards, detailed plans, tasks, decisions, activity, and project context in one
place so humans and AI coding agents can resume work without rebuilding the
same context every session.

Relay is not a hosted SaaS app. It runs inside Electron and stores user data
in the operating system's app-owned data directory.

---

## Screenshots

<p align="center">
  <img src="docs/screenshots/relay-board.png" alt="Relay board view with filtered task cards and directory workflow controls" width="760">
  <br>
  <em>Board view — organize work into directories, projects, and boards</em>
</p>

<p align="center">
  <img src="docs/screenshots/relay-board-detail.png" alt="Relay board detail with task breakdown and activity" width="760">
  <br>
  <em>Board detail — plan work with phases, tasks, decisions, and activity</em>
</p>

The repository includes a docs-only example workspace at
`docs/examples/mock-workspace.json`. Relay does not seed this data
automatically; new installations start empty.

---

## Features

- **Organize** work into directories, linked projects, and boards.
- **Plan** work with phases, detailed plans, decisions, and important context.
- **Track** cards with status, priority, type, tags, notes, blockers, progress,
  and completion criteria.
- **Record** readable activity for meaningful human and agent actions.
- **Review & commit** Git changes from a built-in workbench: per-file diffs,
  split staged changes into multiple focused commits, a pre-commit review step
  that re-checks HEAD and each file before executing, and commit history with
  side-by-side comparison.
- **Update** with automatic update checks, download, and install from an in-app
  update center backed by electron-updater, with manual check, skip-version,
  and install-and-restart controls.
- **Persist** local state through the Electron preload bridge, not browser-only
  storage.
- **Integrate** with Codex and Claude Code via plugin scripts and hooks for
  context resumption across sessions.

---

## Status

Relay is in active development. The local desktop flow, renderer, app-owned
persistence, manual board workflows, and local Codex/Claude integration scripts
are present and functional. Hosted sync, account management, and signed
production installers are future work.

[Download the latest release](https://github.com/jacobpowaza/Relay/releases) for
macOS (Apple Silicon & Intel), Windows (x64 & arm64), and Linux.

---

## Prerequisites

- Node.js 22 or newer
- pnpm 11
- macOS, Windows, or Linux

## Install

```bash
pnpm install
```

## Run The Desktop App

```bash
pnpm app:dev
```

Relay opens as a native desktop window. User data is stored in:

```text
<Electron userData>/relay-data/workspace.json
```

On macOS development builds:

```text
~/Library/Application Support/Relay/relay-data/workspace.json
```

## Load Example Data

Relay intentionally starts empty. To preview a populated workspace:

```bash
mkdir -p "$HOME/Library/Application Support/Relay/relay-data"
cp docs/examples/mock-workspace.json "$HOME/Library/Application Support/Relay/relay-data/workspace.json"
pnpm app:dev
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

Runs linting, TypeScript checks, tests, and production builds across the
workspace.

---

## Repository Layout

```text
apps/
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

[AGPL-3.0](LICENSE) &mdash; Relay is free software. See `LICENSE` for details.

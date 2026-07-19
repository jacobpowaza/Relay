<p align="center">
  <img src="apps/desktop/build/icon-1024.png" width="96" height="96" alt="Relay">
</p>

<h1 align="center">Relay</h1>
<p align="center"><em>Development planning and context that stays with the project.</em></p>

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
  <a href="https://venmo.com/u/jacobpowaza">
    <img src="https://img.shields.io/badge/donate-Venmo-008CFF?logo=venmo&logoColor=white" alt="Donate">
  </a>
  <img src="https://img.shields.io/badge/platform-macOS%20|%20Windows%20|%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/pnpm-11.10.0-orange" alt="pnpm">
</p>

---

## The Problem

When someone gives an AI coding agent a large task, the work is usually poorly tracked. The agent may create a loose plan, consume a huge amount of context, lose important information between sessions, forget completed work, duplicate tasks, or force the user to repeatedly re-explain the project.

Existing tools either live in the browser (lost when the session ends), require a hosted SaaS account, or are generic project managers that do not understand development semantics — phases, evidence, blockers, decisions, handoffs, or context ranking.

## What Relay Does

Relay is a **local-first desktop planning system** for software work. It gives AI agents (and humans) a persistent workflow where they can plan, track, and record work without losing state between sessions. All data lives on your machine in the operating system's app-owned data directory.

**How it works:**

- You create a **board** for a project or initiative
- You define **phases** and **columns** to organize the work
- You break the plan into **cards** (tasks, features, bugs, decisions, etc.)
- You move cards through columns as work progresses
- You record **activity**, **decisions**, **context**, and **evidence** along the way
- When you or an AI agent returns, the board provides the current state — no need to re-read the entire project history
- Agent integrations (Claude Code, Codex) can read and write to boards through hooks and plugins, preserving context across sessions

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

---

## Features

- **Organize** work into directories, linked projects, and boards.
- **Plan** work with phases, detailed plans (Markdown), decisions, and context records.
- **Track** cards with status, priority, type, tags, notes, blockers, progress, and completion criteria.
- **Kanban board** with drag-and-drop columns, card filters, phase grouping, and column management.
- **Dashboard** with board overview, recent activity, directory navigation, and a "continue working" shortcut.
- **Git workbench** — review staged/unstaged changes, split changes into multiple focused commits, pre-commit review step that re-checks HEAD before executing, commit history with side-by-side comparison, and push.
- **Context records** — store categorized context (architecture, current state, decisions, warnings) with confidence levels for future sessions.
- **Decision log** — record decisions with alternatives, consequences, and status.
- **Activity timeline** — every meaningful action is recorded with actor, target, and timestamp.
- **Auto-update** — in-app update center backed by electron-updater with manual check, skip-version, dismiss, and install-and-restart controls.
- **Single-instance lock** — second launch focuses the running window, no duplicate processes.
- **macOS menu-bar mode** — hide to the menu bar with background presence, launch at login, and tray controls.
- **Integration with Claude Code** — plugin with session hooks that identify the repository and emit concise context packets.
- **Integration with Codex** — plugin with MCP server, session hooks, and skills for context resumption.
- **Local-only** — all data stays on your machine by default. No account required, no SaaS.

---

## Downloads

[Download the latest release](https://github.com/jacobpowaza/Relay/releases) for your platform.

### macOS

| Architecture | File |
|---|---|
| Apple Silicon (M1/M2/M3/M4) | `Relay-<version>-arm64.dmg` |
| Intel | `Relay-<version>.dmg` |

**Gatekeeper note:** The application is not yet signed with an Apple Developer ID certificate. When you open it for the first time, macOS may show "Relay cannot be opened because the developer cannot be verified." To bypass:
- Right-click (or Ctrl-click) the app and select **Open**
- Click **Open** in the dialog

Alternatively, go to **System Settings > Privacy & Security** and click **Open Anyway**.

### Windows

| Architecture | File |
|---|---|
| x64 | `Relay-Setup-<version>-x64.exe` |
| ARM64 | `Relay-Setup-<version>-arm64.exe` |

**SmartScreen note:** The installer is not yet Authenticode-signed. Windows SmartScreen may show a warning. Click **More info** then **Run anyway** to install.

### Linux

| Architecture | File |
|---|---|
| x64 | `Relay-<version>.AppImage` |

Make the AppImage executable: `chmod +x Relay-*.AppImage`

---

## Data And Privacy

- All data is stored locally on your machine.
- No account, registration, or internet connection is required.
- No telemetry, analytics, or usage data is collected.
- No data is sent to any external server unless you configure an API endpoint.
- Application data is stored in the OS app data directory (see paths below).
- Integration plugin config is stored under `~/.relay/integrations/config.json`.
- Claude Code and Codex integrations are disabled by default until you enable them.
- The application never creates sample boards or fake activity — new installations start empty.

### Storage Locations

| Data | Path |
|---|---|
| Workspace (boards, cards, plans) | `userData/relay-data/workspace.json` |
| App settings (updates, background) | `userData/relay-settings.json` |
| Integration plugin config | `~/.relay/integrations/config.json` |

`userData` resolves to the standard OS application data directory:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Relay/` |
| Windows | `%APPDATA%/Relay/` |
| Linux | `~/.config/Relay/` |

---

## How It Works

### Boards and Cards

A **board** represents a project or initiative. Each board contains:

- **Phases** — logical groups of work (e.g., "Foundation", "Core Features", "Polish")
- **Columns** — status lanes (e.g., Backlog, Ready, In Progress, Review, Verified)
- **Cards** — individual work items with type, priority, tags, description, and progress
- **Plan** — a detailed Markdown document for the full implementation plan
- **Context** — categorized memory records with confidence levels
- **Decisions** — structured decision log with alternatives and consequences
- **Activity** — chronological audit trail of all meaningful actions

### Agent Integrations

Relay provides integrations for AI coding agents so they can read and write board state automatically.

**Claude Code:** The `integrations/claude-code/` plugin hooks into Claude Code sessions. On session start, it identifies the repository, checks if it is linked to a board, and emits a concise context packet. Checkpoint hooks record progress during the session. Session-end hooks produce structured handoffs for the next session.

**Codex:** The `integrations/codex/` plugin provides the same capabilities through Codex's plugin system, including an MCP server for real-time board operations and session hooks for context resumption.

### Token-Saving Behavior

Relay minimizes token usage in AI agent contexts by:

- Emitting **concise context packets** instead of dumping the full project history
- Ranking context by relevance to the current card
- Including only active decisions, current blockers, and the latest handoff by default
- Recording **meaningful engineering rationale** rather than hidden model reasoning
- Allowing agents to retrieve omitted details explicitly rather than receiving everything

This means an agent can resume work from a handoff (typically <1k tokens) rather than re-reading an entire conversation or project plan.

---

## Prerequisites

- **Node.js** 22 or newer
- **pnpm** 11
- macOS, Windows, or Linux

## Development Setup

```bash
# Clone the repository
git clone https://github.com/jacobpowaza/Relay.git
cd Relay

# Install dependencies
pnpm install

# Start the desktop app in development mode
pnpm app:dev
```

This starts the Next.js renderer dev server and launches the Electron app connected to it. The renderer automatically uses an available port (default: 4317, fallback: 4318+ if taken).

### Environment Configuration

Copy `.env.example` to `.env` in the project root:

```bash
cp .env.example .env
```

The environment file is **optional** for local desktop development. The desktop app stores everything locally and does not require a database or API.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `APP_ORIGIN` | No | `http://localhost:4317` | Origin of the renderer frontend (for CORS) |
| `API_ORIGIN` | No | `http://localhost:4318` | Where the API server listens |
| `DATABASE_URL` | No | — | PostgreSQL connection string (for optional sync) |
| `BETTER_AUTH_SECRET` | No | — | Auth signing secret (for optional sync) |
| `BETTER_AUTH_URL` | No | — | Auth URL (for optional sync) |
| `NEXT_PUBLIC_API_ORIGIN` | No | — | API origin exposed to browser (for optional sync) |
| `OBJECT_STORAGE_ENDPOINT` | No | `http://localhost:9000` | S3-compatible storage endpoint (for optional sync) |
| `OBJECT_STORAGE_ACCESS_KEY` | No | — | Storage access key |
| `OBJECT_STORAGE_SECRET_KEY` | No | — | Storage secret key |
| `OBJECT_STORAGE_BUCKET` | No | — | Storage bucket name |

Without `.env`, the desktop app operates in fully local mode with no external dependencies.

### Infrastructure (Optional)

For development with the optional API, database, and object storage:

```bash
# Start PostgreSQL and MinIO
docker compose -f infra/compose.yaml up -d

# Run database migrations
pnpm --filter @relay/database db:migrate

# Start the API
pnpm api:dev
```

### Load Example Data

Relay starts empty. To preview a populated workspace:

```bash
mkdir -p "$HOME/Library/Application Support/Relay/relay-data"
cp docs/examples/mock-workspace.json "$HOME/Library/Application Support/Relay/relay-data/workspace.json"
pnpm app:dev
```

---

## Available Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Run the desktop app in development mode |
| `pnpm app:dev` | Same as above (alias) |
| `pnpm api:dev` | Run the optional API server in development mode |
| `pnpm build` | Build all packages and the web renderer |
| `pnpm app:package` | Package the desktop app for distribution |
| `pnpm lint` | Run ESLint across all packages |
| `pnpm typecheck` | Run TypeScript type checking across all packages |
| `pnpm test` | Run tests across all packages |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm check` | Run lint + typecheck + test + build (CI gate) |

## Build

```bash
# Build all packages and the web renderer
pnpm build

# Package the desktop app (DMG/EXE/AppImage)
pnpm app:package
```

Packaging uses [electron-builder](https://www.electron.build/) configured in `apps/desktop/electron-builder.yml`. Artifacts are written to `apps/desktop/release/`.

### Dynamic Port Selection

The API server does not assume a fixed port. On startup:

1. It attempts to bind to the preferred port from `API_PORT` env or the default **4318**
2. If that port is in use, it tries the next port (4319, 4320, etc.) up to 20 attempts
3. The selected port is logged to the console

The renderer dev server (`pnpm dev`) follows the same pattern, defaulting to **4317** and scanning forward until it finds an available port.

### Packaged Build Configuration

When running from a packaged build, the application does **not** require `.env` configuration. On first launch it:

- Creates the workspace data directory under the OS application data directory
- Initializes an empty workspace
- Generates default app settings
- Uses safe defaults for all configuration values

The optional API server (`pnpm api:dev` or `pnpm api:start`) reads environment variables for configuration. The desktop app itself runs without any external services.

---

## Project Architecture

```text
relay/
├── apps/
│   ├── desktop/          Electron main process, preload bridge, local storage
│   ├── web/              Static Next.js renderer embedded in Electron
│   └── api/              Optional API server (Fastify) for agent/sync
├── packages/
│   ├── application/      Application service layer
│   ├── contracts/        Shared Zod schemas and API contracts
│   ├── database/         Optional PostgreSQL persistence (Drizzle ORM)
│   └── domain/           Domain rules, ranking, context, evidence
├── integrations/
│   ├── claude-code/      Claude Code plugin, hooks, and scripts
│   ├── codex/            Codex plugin, MCP server, hooks, and scripts
│   └── core/             Shared integration utilities
├── docs/
│   ├── decisions/        Architecture decision records
│   ├── examples/         Example workspace data
│   ├── screenshots/      README screenshots
│   └── stages/           Implementation stage reports
└── infra/
    └── compose.yaml      Local dev infrastructure (PostgreSQL, MinIO)
```

### Desktop App (Electron)

The Electron main process (`apps/desktop/src/`) owns all local file access. The renderer (Next.js static export) communicates through a **context-isolated preload bridge** with sandboxed Node.js. The preload exposes a narrow `window.relayDesktop` API for workspace data, Git operations, update management, and app settings.

### Web Renderer (Next.js)

The renderer is a static Next.js App Router export (`output: "export"`) that runs entirely in the Electron renderer process. It uses React, CSS modules (`globals.css`), and Lucide icons. There is no web server — the static HTML/JS/CSS is served directly from the filesystem via `window.loadFile()`.

### Core Domain

The `packages/domain/` package contains pure business logic: entity types, state machines, ranking algorithms, context prioritization, and evidence rules. It has no runtime dependencies beyond TypeScript.

### Integrations

Agent integrations follow a **fail-open** design: if Relay is unavailable, the integration does not block the coding session. Each integration plugin:

- Identifies the local Git repository on session start
- Checks if the repository is linked to a Relay board
- Emits a concise context packet (not the full board) as additional context
- Records checkpoints during the session
- Produces a structured handoff on session end

---

## Environment Configuration

The repository includes `.env.example` with the following variables:

```
APP_ORIGIN=http://localhost:4317
API_ORIGIN=http://localhost:4318
DATABASE_URL=postgres://relay@localhost:5432/relay
BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters
BETTER_AUTH_URL=http://localhost:4318
NEXT_PUBLIC_API_ORIGIN=http://localhost:4318
OBJECT_STORAGE_ENDPOINT=http://localhost:9000
OBJECT_STORAGE_ACCESS_KEY=relay
OBJECT_STORAGE_SECRET_KEY=replace-in-local-env
OBJECT_STORAGE_BUCKET=relay
```

**Required for desktop-only usage:** None. The desktop app works without any environment variables.

**Required for optional API/sync:** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`. The database and object storage variables are only needed if you run the server components.

**Packaged builds** generate the following automatically on first launch:
- A secure random secret is generated if authentication is configured
- Default settings are written to the app data directory
- The workspace file is initialized as an empty workspace

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run `pnpm check` to verify lint, types, tests, and build
5. Commit your changes
6. Push and open a Pull Request

All contributions must be licensed under AGPL-3.0.

---

## Release Process

Releases are built and published through GitHub Actions. To trigger a release:

1. Update the version in `package.json` (root and `apps/desktop/package.json`)
2. Tag the commit: `git tag v<version>` (e.g., `v0.2.0`)
3. Push the tag: `git push origin v<version>`
4. The release workflow builds and publishes artifacts automatically

### Manual Build

```bash
# Build all dependencies
pnpm build

# Package the desktop app (unsigned, local only)
pnpm app:package
```

Artifacts are written to `apps/desktop/release/`.

### macOS Signing

For signed and notarized builds, set these environment variables:

```
CSC_LINK=/path/to/DeveloperIDApplication.p12
CSC_KEY_PASSWORD=********
APPLE_ID=you@apple.com
APPLE_APP_SPECIFIC_PASSWORD=****-****-****-****
APPLE_TEAM_ID=XXXXXXXXXX
```

### Windows Signing

For Authenticode-signed installers:

```
CSC_LINK=/path/to/codesign.pfx
CSC_KEY_PASSWORD=********
```

---

## Limitations

- **No server-side sync yet:** Boards are stored locally only. Cross-device sync and team collaboration are future work.
- **No authentication in desktop mode:** The desktop app uses a "local user" identity. Authentication is only present in the optional API component.
- **No hosted SaaS:** There is no cloud-hosted version. You run the desktop app on your machine.
- **Single-user per instance:** The desktop app is designed for one user. Multi-user boards require the API.
- **No mobile app:** Relay runs on desktop only (macOS, Windows, Linux).
- **Unsigned installers:** macOS and Windows builds are unsigned by default. Users must bypass security warnings until signing is configured.
- **Auto-update requires signed builds:** electron-updater verifies code signatures. Unsigned builds cannot auto-update in production.
- **Markdown-only plans:** The plan editor is a textarea with Markdown. There is no rich-text or WYSIWYG editor.
- **Persistence limit:** Workspace files are capped at 10 MB. Very large boards may require future optimization.

---

## Roadmap

- **Server-side sync** — boards shared across devices and team members
- **Signed installers** — macOS notarization and Windows Authenticode signing
- **Auto-update infrastructure** — production auto-update channel
- **Authentication** — user accounts with workspace membership
- **API stabilization** — stable API for third-party integrations
- **Improved context ranking** — better relevance scoring for agent context packets
- **Template boards** — reusable board templates for common project types
- **GitHub integration** — import issues, create PRs from cards, link commits
- **Search** — full-text search across boards, cards, and context
- **Performance improvements** — virtualized card lists for large boards
- **Dark mode refinements** — complete dark mode coverage (currently "system" aware with basic support)
- **Plugin marketplace** — user-contributed integrations and tools

---

## Troubleshooting

| Problem | Solution |
|---|---|
| macOS "cannot be opened because the developer cannot be verified" | Right-click the app and select Open, or go to System Settings > Privacy & Security and click Open Anyway |
| Windows SmartScreen blocks installation | Click "More info" then "Run anyway" |
| App won't start (port conflict) | Kill the conflicting process or set `API_PORT` / `RELAY_DEV_SERVER_URL` environment variables to use different ports |
| Workspace data is missing | Check `~/Library/Application Support/Relay/relay-data/workspace.json` (macOS) or the equivalent path on your OS |
| Integration plugins not working | Ensure the integration is enabled in Relay settings: open the user menu > Settings > Integrations |
| Renderer shows blank screen | Check the Developer Tools console (Cmd+Option+I in dev mode). The renderer should load the static export from `index.html` |
| Git workbench shows no changes | Ensure the board is linked to a local Git repository directory |
| Auto-update says "Updates are delivered in packaged builds" | This is expected in development mode. Packaged builds can check for updates |

---

## Acknowledgements

- [electron-builder](https://www.electron.build/) — cross-platform packaging
- [electron-updater](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater) — auto-update support
- [Next.js](https://nextjs.org/) — static site renderer
- [Fastify](https://fastify.dev/) — API server framework
- [Drizzle ORM](https://orm.drizzle.team/) — optional database ORM
- [Turbo](https://turbo.build/) — monorepo build system
- [Zod](https://zod.dev/) — schema validation
- [Lucide](https://lucide.dev/) — open-source icons
- [Geist](https://vercel.com/font) — UI font family

## License

[AGPL-3.0](LICENSE) &mdash; Relay is free software. See `LICENSE` for details.

If you find Relay useful, consider [donating via Venmo](https://venmo.com/u/jacobpowaza) to help fund future development.

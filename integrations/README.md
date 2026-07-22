# Relay integrations

Two plugin surfaces — `claude-code/` and `codex/` — over one shared core
(`core/`, vendored into each platform as `core/` by `scripts/vendor-core.mjs`).

Behavior is meant to be identical across platforms. Where it is not, the
asymmetry is a platform limitation and is documented below rather than left for
the next person to rediscover.

## Discovery is passive

Discovery is never a step the user asks for. The index is maintained as a side
effect of ordinary work:

1. A task creates or resumes a board.
2. As the agent edits files, the `PostToolUse` discovery-index hook marks each
   edited path as pending.
3. A pending path is re-indexed only once it has gone **quiet** — no further
   edits for `RELAY_DISCOVERY_QUIET_MS` (default 90s). A file edited five times
   in a row is indexed once, after the last edit, not five times.
4. `SessionEnd` flushes everything still pending, however recently it changed:
   the session is over, so the file is final.

Pending state lives in `~/.relay/integrations/discovery-pending.json`, which is
plugin-owned. It is deliberately **not** in `workspace.json` — the desktop app
holds that in memory, and churning it on every edit invites write races.

Nothing here spawns an agent. Agent enrichment (`apps/desktop/src/enrichment.cjs`)
is separate, on demand, and user-initiated.

## Shared core

`integrations/core/src/` is the only place discovery logic lives. Both
platforms' hooks delegate to it, so a fix applies to both:

| Export | Purpose |
| --- | --- |
| `loadDiscoveryFromWorkspace` | Reads the index from app-owned storage |
| `deriveEntryChanges` | Which indexed files changed or vanished, derived from disk |
| `selectRelevantEntries` | The entries worth showing for a given task |
| `buildDiscoveryContextPacket` | The session-start context block |
| `buildDiscoveryLine` | One-line summary for a status line |

Run `pnpm --filter @relay/integration-core build` after editing; that re-vendors
`core/` into both platforms. The vendored copies are build output — edit
`integrations/core/src/`, never `integrations/*/core/`.

## Platform divergence

### Status line — Claude Code only

Claude Code exposes a `statusLine` setting in `~/.claude/settings.json`, so
`claude-code/scripts/statusline.mjs` renders a live indicator. Register it with:

```sh
node integrations/claude-code/scripts/install-statusline.mjs
```

It composes with an existing `statusLine` rather than replacing it, and `--force`
overwrites.

**Codex has no status line mechanism.** There is no `statusLine` equivalent, no
`config.toml` key, and no CLI flag. Verified against codex v0.144.6.

The fallback is the same script shipped at `codex/scripts/statusline.mjs` as an
**on-demand** command — same output, but the user must ask for it:

```sh
node integrations/codex/scripts/statusline.mjs
```

Continuous, always-visible status exists only on Claude Code. Codex users get
board state at session start (via the `SessionStart` hook) and on request.

### Plugin manifest shape

| | Claude Code | Codex |
| --- | --- | --- |
| Manifest | `.claude-plugin/plugin.json` | `hooks.json` |
| Plugin root variable | `${CLAUDE_PLUGIN_ROOT}` | `${PLUGIN_ROOT}` |
| MCP server | — | `mcp/` |
| Status line | `scripts/statusline.mjs`, automatic | `scripts/statusline.mjs`, manual |

Hook events (`SessionStart`, `PostToolUse`, `PreCompact`, `SessionEnd`) and their
timeouts match across platforms. Only the tool **matchers** differ, because the
tool names do:

- Claude Code: `Edit|Write|MultiEdit|NotebookEdit`
- Codex: `functions.apply_patch|Edit|Write|MultiEdit`

Shell tool calls (`Bash`, `functions.exec_command`) are deliberately not indexed
on either platform: a shell command string cannot be reliably parsed into the
paths it touched, so a file created via `cat > x.ts` is missed until the next
full scan.

### The CLI copies

`claude-code/scripts/relay-progress.mjs` and `codex/scripts/relay-progress.mjs`
are byte-identical and must stay that way. Agent identity is derived at runtime
from `argv[1]`, so nothing needs to differ:

```js
const agentName = process.env.RELAY_AGENT_NAME ?? (process.argv[1]?.includes("claude") ? "Claude" : "Codex");
```

Nothing enforces that the two stay in sync — they are copied by hand, and they
have drifted before. Diff them after editing either one.

**Known open question:** board resolution precedence. The copies were once
diverged on whether `--board-id` or `--task-id` wins when both are supplied.
They were unified on `--task-id` first, which is what the Claude copy did; an
explicit `--board-id` arguably ought to outrank an id derived from request text.
No test covers the collision.

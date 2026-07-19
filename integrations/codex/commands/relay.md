---
description: Show Relay status, resume the linked board, or checkpoint current Codex progress.
argument-hint: [status|resume|checkpoint|create-board]
allowed-tools: [Bash]
---

# Relay

Use this command when the user types `/relay`.

## Arguments

The user invoked this command with: `$ARGUMENTS`

## Behavior

Choose the first matching mode:

1. `status`, empty arguments, or unclear arguments: show Relay status for the current directory.
2. `resume`, `continue`, or `pickup`: load the Relay resume packet for the current directory and continue from the next recommended task.
3. `checkpoint`: write a concise checkpoint for the current work before ending, compacting, or switching tasks.
4. `create-board <title>`: create or link a Relay board for the current directory using the provided title.

Prefer the MCP tools when available:

- `relay_status` for status.
- `relay_resume` for resume.

If MCP tools are unavailable, run the local script from the installed plugin root:

```bash
node "$PLUGIN_ROOT/scripts/relay-progress.mjs" status --cwd "$PWD"
node "$PLUGIN_ROOT/scripts/relay-progress.mjs" resume --cwd "$PWD"
```

If `$PLUGIN_ROOT` is not set by the host, locate the installed plugin root first:

```bash
find "$HOME/.codex/plugins" "$HOME/.codex/plugins/cache" -path '*/relay/scripts/relay-progress.mjs' -print -quit 2>/dev/null
```

Then run the matching script with the found path.

## Checkpoint Format

For checkpoint mode, write meaningful progress only. Do not dump raw terminal logs.

```bash
printf '%s' '{"summary":"Brief result","changedFiles":[],"commands":[],"tests":[],"progress":0}' \
  | node "$PLUGIN_ROOT/scripts/relay-progress.mjs" checkpoint --cwd "$PWD"
```

Include changed files, commands, validation, blockers, and next task when known.

## Output

Report:

- Visible Relay state, such as `[RELAY] Active`, `[RELAY] Inactive`, or `[RELAY] Error`.
- Linked board name.
- Active or recommended next task.
- Any error that prevents Relay from loading.

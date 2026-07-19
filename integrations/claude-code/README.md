# Relay Claude Code Integration

Claude Code adapter packages:

- `.claude-plugin/plugin.json` for plugin metadata and lifecycle hooks.
- `skills/progress/SKILL.md` for model-invoked Relay workflow.
- `hooks/session-start.mjs` for compact always-active startup context.
- `hooks/checkpoint-hint.mjs` for low-noise checkpoint reminders.
- `hooks/session-end.mjs` for local session-exit fallback evidence.

Install during development with:

```sh
claude --plugin-dir ./integrations/claude-code
```

Users must enable/trust plugin hooks in Claude Code. Hook scripts fail open and never read source files or environment variables.

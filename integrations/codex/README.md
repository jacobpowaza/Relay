# Relay Codex Integration

Codex adapter packages:

- `.codex-plugin/plugin.json` for plugin metadata, hooks, skill, and MCP registration.
- `commands/relay.md` for the `/relay` slash command.
- `hooks.json` for lifecycle activation.
- `skills/progress/SKILL.md` for always-available Relay workflow.
- `.mcp.json` for MCP registration.
- `mcp/relay-mcp.mjs` exposes `relay_status` and `relay_resume` over stdio MCP.

Use `/relay` in Codex to show status, resume the linked board, create a board,
or checkpoint meaningful progress.

Codex plugin hooks are non-managed hooks. Users must review and trust them through `/hooks`; Codex will skip untrusted hooks.

Install during development through Codex plugin browser or local plugin installation once available in the target Codex surface. Hooks fail open and do not read source files or environment variables.

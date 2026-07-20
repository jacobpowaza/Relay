# Changelog

## [0.2.0] — 2026-07-19

### Integrations

- Vendored `@relay/integration-core` into each plugin as `core/` — plugins are now self-contained with no monorepo dependency
- Updated hooks (`session-end.mjs`) to import from vendored core instead of `../../core/dist/src/index.js`
- Added `package.json` with `"type": "module"` to claude-code and codex integrations
- Added persistent status line scripts (`statusline.mjs`, `install-statusline.mjs`) for Claude Code footer indicator
- Published plugin marketplace to `jacobpowaza/relay-plugins` — install without cloning the full monorepo
- Enhanced `sync-plugins.mjs` to build core, vendor, and perform full plugin replacement

### Packaging

- Replaced `src/**` glob in `electron-builder.yml` with explicit allowlist of 12 runtime files
- Excluded dev manifests and `_not-found/` from the renderer ASAR
- Removed docs, designs, plans, decision records, and stage reports from packaging

### Release

- Full CI validation: lint, typecheck, 104 tests (unit + integration), production build
- electron-builder packaging with auto-update metadata (`latest-mac.yml`)
- Code-signed and hardened runtime (macOS)
- Verified ASAR contents, sandbox, renderer loading
- Gitleaks false-positive fix in `redaction.test.ts`

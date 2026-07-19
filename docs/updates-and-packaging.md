# Updates, Packaging & Cross-Platform Release Guide

Relay ships auto-updates through **electron-updater** (the maintained companion
to electron-builder). The main process owns the whole flow — detection,
download, verification, install/relaunch, and post-restart confirmation — behind
typed services in `apps/desktop/src`. This document covers what a release must
publish so the updater works on every supported platform.

## Supported targets

| OS | Arch | Installer | Auto-update artifact |
|----|------|-----------|----------------------|
| macOS | Apple Silicon (`arm64`) | `.dmg` | `.zip` + `latest-mac.yml` |
| macOS | Intel (`x64`) | `.dmg` | `.zip` + `latest-mac.yml` |
| Windows | `x64` | NSIS `.exe` | `.exe` + `latest.yml` |
| Windows | `arm64` | NSIS `.exe` | `.exe` + `latest.yml` |
| Linux | `x64` | `.AppImage` | `.AppImage` + `latest-linux.yml` |

macOS auto-update **requires the ZIP** (electron-updater cannot update from a
DMG). The DMG is only for first-time install.

## Required GitHub Release assets

Publish to `https://github.com/jacobpowaza/Relay` releases, tagged `v<version>`
(e.g. `v0.2.0`). electron-builder produces and uploads these when you run the
packaging command with a `GH_TOKEN`:

```
Relay-<version>-arm64.dmg
Relay-<version>-arm64-mac.zip
Relay-<version>.dmg                 # x64 dmg
Relay-<version>-mac.zip             # x64 zip
Relay-Setup-<version>-x64.exe
Relay-Setup-<version>-arm64.exe
Relay-<version>.AppImage
latest-mac.yml
latest.yml
latest-linux.yml
*.blockmap                          # differential-download maps
```

The `latest*.yml` **updater metadata** files are mandatory — they carry the
version, per-file `sha512` checksums, and file sizes electron-updater uses to
select and verify the correct asset. Never delete or hand-edit them.

## Checksums & signature verification

electron-updater verifies every download before it is ever executed:

1. **sha512 checksum** from `latest*.yml` must match the downloaded file.
2. **Code signature** must be valid:
   - macOS: the app must be signed + notarized; the ZIP's signature is checked.
   - Windows: the NSIS installer must be Authenticode-signed; the publisher name
     is matched.

A checksum or signature mismatch surfaces as the `failed` update phase and the
update is discarded — `installAndRestart()` refuses to run unless the state is
`ready`.

## macOS signing & notarization

Set these before `pnpm --filter @relay/desktop package`:

```
export CSC_LINK=/path/to/DeveloperIDApplication.p12   # or base64 in CI
export CSC_KEY_PASSWORD=********
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=****-****-****-****
export APPLE_TEAM_ID=XXXXXXXXXX
```

- `hardenedRuntime: true` is set in `electron-builder.yml`.
- Add `build/entitlements.mac.plist` and reference it under `mac.entitlements`
  if the app needs specific entitlements; uncomment the line in the config.
- electron-builder notarizes automatically when the Apple credentials are
  present.

## Windows code signing

```
export CSC_LINK=/path/to/codesign.pfx     # or WIN_CSC_LINK
export CSC_KEY_PASSWORD=********
```

- NSIS is configured `perMachine: false` + `allowElevation: true`, so a standard
  user can install without admin; elevation is requested only when needed.
- Locked-file handling is managed by NSIS/electron-updater: the running app is
  closed and replaced on relaunch.
- ARM64 builds are only published if you build on/for ARM64; omit that arch
  otherwise and the updater will report "no compatible asset" cleanly.

## Build & publish commands

```
# Local unsigned build (no publish):
pnpm --filter @relay/desktop package

# CI publish to GitHub Releases:
GH_TOKEN=<token> pnpm --filter @relay/desktop package -- --publish always
```

Building for a non-native arch (e.g. macOS x64 on Apple Silicon) uses
`--x64` / `--arm64` / `--universal` electron-builder flags.

## Data safety across updates

Updates never touch user data. Boards, settings, plugin config, repositories and
workspace data live outside the app bundle:

- Workspace/board data: `userData/relay-data/workspace.json`
- App (update + background) settings: `userData/relay-settings.json`
- Plugin/integration config: `~/.relay/integrations/config.json`

`userData` is preserved by both the macOS and Windows installers.

## Local testing without a signed build

Set `RELAY_FORCE_UPDATE=1` to exercise the updater state machine in a dev build
(it otherwise reports "updates are delivered in packaged builds"). For a full
end-to-end test, install a lower version from a real signed release and let it
update to a newer published release.

## Verification checklist

Run against **packaged** macOS and Windows builds, not just `pnpm dev`:

- [ ] Manual "Check for Updates" — current, available, and failed states
- [ ] Automatic check on launch (Automatic update checks toggle on)
- [ ] Draft and prerelease releases ignored on the stable channel
- [ ] Prerelease channel surfaces prereleases when enabled
- [ ] Network failure and malformed `latest.yml` → clean `failed` state
- [ ] Correct asset chosen for mac arm64, mac x64, win x64, win arm64
- [ ] Interrupted download retries (up to 3 attempts)
- [ ] Checksum/signature mismatch is rejected, never installed
- [ ] Restart-and-install relaunches into the new version
- [ ] Post-restart version confirmation clears the pending marker
- [ ] Skipped / dismissed versions are not re-prompted
- [ ] Settings persist across restart (`relay-settings.json`)
- [ ] Launch-at-login registers on macOS and Windows
- [ ] Close → hide vs. full quit behaves per setting; tray Quit tears down
      watchers, timers, child processes and tray (no reopen)
- [ ] No duplicate tray icons or duplicate update checks (single-instance lock)
- [ ] Watchers/timers cleaned up on window close and quit
- [ ] Idle CPU ≈ 0% in packaged build (dev Diagnostics panel for reference)
- [ ] Light and dark themes render the Updates/Background UI + popup correctly

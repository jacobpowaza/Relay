# ADR 0002: Local-first desktop application

Status: Accepted  
Date: 2026-07-17

## Decision

Relay ships first as an Electron desktop application. The Next.js package is a
static renderer embedded in Electron, not a hosted product. A context-isolated
preload bridge exposes narrow load and save operations, and the main process
persists workspace data atomically beneath Electron's `userData` directory.

New installations start empty. Relay does not seed projects, sessions,
activity, evidence, or derived health scores. Light mode is the initial theme,
and the renderer fills the native window without an outer scenic frame.

## Reason

The product is intended to retain sensitive development context locally and to
feel like a focused native utility. Requiring a browser, account, or server for
the initial product would violate that workflow and make fabricated preview
content easy to confuse with user records.

## Consequences

- `apps/desktop` owns local file access and native packaging.
- `apps/web` cannot use browser storage or direct Node.js APIs.
- PostgreSQL and the Fastify API are optional foundations for later sync and
  agent integrations, not desktop runtime dependencies.
- Dark mode will only be added as an explicit, complete user preference.
- Imported or corrupt local data must be validated at the desktop boundary.

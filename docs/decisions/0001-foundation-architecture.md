# ADR 0001: Foundation architecture

Status: Accepted  
Date: 2026-07-17

## Decision

Relay uses a TypeScript monorepo with a Next.js web application, a Fastify API,
PostgreSQL persistence, shared Zod contracts, and isolated domain logic.

Current state uses mutable relational tables. Every meaningful mutation appends
an immutable activity event and outbox event in the same transaction. Relay does
not use event sourcing as its primary persistence model.

## Reason

The product needs transactional invariants, object-level authorization,
optimistic concurrency, searchable history, and several clients. Keeping the
domain independent from web rendering and integration packaging avoids
duplicating rules when CLI, MCP, Claude Code, and Codex clients are added.

## Consequences

- The API is a versioned contract even while the web and API live together.
- Database integration requires PostgreSQL rather than an in-memory production
  fallback.
- Activity history can be rebuilt from domain mutations but is not the source
  used to reconstruct all current state.
- Integrations cannot import database repositories.

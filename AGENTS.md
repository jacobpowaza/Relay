# Relay development instructions

## Product contract

- Read `docs/implementation-plan.md` before changing architecture or scope.
- Treat repository code as the source of truth for implementation state.
- Treat accepted Relay records as the source of truth for plans and decisions.
- Keep implementation complete, verified, shipped, and production verified as
  separate evidence-derived concepts.
- Never store or request hidden chain-of-thought. Record concise engineering
  rationale and evidence instead.
- Relay is a desktop application, not a hosted website. The renderer must run
  inside the Electron shell and use app-owned persistence through the preload
  bridge.
- Local-first means a new installation contains no seed data, sample projects,
  fabricated activity, or fake metrics.

## Engineering rules

- Use pnpm workspace commands from the repository root.
- Keep business rules in `packages/domain`, contracts in `packages/contracts`,
  local desktop persistence in `apps/desktop`, optional server persistence in
  `packages/database`, and rendering in `apps/web`.
- Integrations call application services or the public API. They never access
  the database directly.
- Validate untrusted data at boundaries with shared schemas.
- Authorize every object-level read and mutation.
- Use optimistic versions and idempotency keys for collaborative writes.
- Add tests for changed behavior and run `pnpm check` before completion.
- Update the relevant stage report when a stage exit gate is reached.

## Interface rules

- Preserve the native-utility visual direction from the implementation plan.
- Keep light mode as the default and only supported theme until a complete,
  user-controlled dark theme is implemented.
- The renderer fills the native window. Do not reintroduce a scenic frame or
  decorative border around the application shell.
- Maintain keyboard, screen-reader, reduced-motion, and mobile alternatives.
- Do not add placeholder controls, fake metrics, or disconnected forms.

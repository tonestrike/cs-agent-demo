# Styleguide

This guide captures the conventions established in the repo so far.

## Principles
- ESM only: all packages use `"type": "module"`.
- Zod schemas are the source of truth; infer types from schemas when possible.
- Keep handlers thin; put logic in use-cases and repositories.
- Prefer function-based dependency injection (context factories).
- Prefer inference over extra type aliases unless multiple implementations exist.
- Prefer standard packages over custom implementations when they meet the need.

## Structure
- `apps/worker` Worker API (oRPC) and adapters.
- `packages/core` shared domain + schemas (no Cloudflare bindings).
- `docs` project docs and plans.

## Utilities
- Place shared helpers in `packages/core/src/utils`.
- Use third-party utilities before creating new ones.
- Keep utilities small and single-purpose. See [`phone.ts`](../packages/core/src/utils/phone.ts).

## Patterns
- **Routing**: `routes/*` define oRPC handlers only.
- **Use-cases**: `use-cases/*` orchestrate domain logic.
- **Repositories**: `repositories/*` abstract D1 access.
- **Context**: `createContext` wires dependencies per request.

## Testing
- Prefer integration tests for Worker/D1 behavior.
- Use local D1 via Wrangler proxy in integration tests.

## Tooling
- Run `bun lint`, `bun typecheck`, `bun run test` before push.
- Use `bun fix` to apply format + lint fixes.

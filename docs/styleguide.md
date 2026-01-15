# Styleguide

This guide captures the conventions established in the repo so far.

## Principles
- ESM only: all packages use `"type": "module"`.
- Zod schemas are the source of truth; infer types from schemas when possible.
- Keep handlers thin; put logic in use-cases and repositories.
- Prefer function-based dependency injection (context factories).
- Prefer standard packages over custom implementations when they meet the need.

## Structure
- `apps/worker` Worker API (oRPC) and adapters.
- `packages/core` shared domain + schemas (no Cloudflare bindings).
- `docs` project docs and plans.

## Patterns

### Routing
Route handlers in [`apps/worker/src/routes/`](../apps/worker/src/routes/) define oRPC endpoints. Keep them thin—extract params, call use-case, return response.

```typescript
// routes/tickets.ts
export const getTicket = factory.rpc({
  route: '/tickets/:id',
  handler: async (c) => {
    const { id } = c.req.param();
    const ticket = await getTicketUseCase(c, { id });
    if (!ticket) return c.json({ error: 'Not found' }, 404);
    return c.json(ticket);
  },
});
```

### Use Cases
Use cases in [`apps/worker/src/use-cases/`](../apps/worker/src/use-cases/) orchestrate domain logic. Call repositories, apply business rules, return data.

```typescript
// use-cases/tickets.ts
export async function getTicketUseCase(c: Context, params: { id: string }) {
  const repo = getTicketRepository(c);
  return await repo.getById(params.id);
}
```

### Repositories
Repositories in [`apps/worker/src/repositories/`](../apps/worker/src/repositories/) abstract D1 database access. All SQL goes here. Return domain types from [`packages/core`](../packages/core/src/).

```typescript
// repositories/tickets.ts
export function getTicketRepository(c: Context) {
  const db = c.env.DB;
  
  return {
    async getById(id: string): Promise<Ticket | null> {
      const row = await db.prepare('SELECT * FROM tickets WHERE id = ?')
        .bind(id)
        .first();
      return row ? mapRowToTicket(row) : null;
    },
  };
}
```

### Context
[`createContext`](../apps/worker/src/context.ts) wires dependencies per request. Pass context through the call chain.

```typescript
// context.ts
export function createContext(c: HonoContext) {
  return {
    env: c.env,
    // Add other dependencies here
  };
}

// Usage in routes
const ticket = await getTicketUseCase(c, { id });
```

## Testing
- Prefer integration tests for Worker/D1 behavior.
- Use local D1 via Wrangler proxy in integration tests.

## Tooling
- Run `bun lint`, `bun typecheck`, `bun run test` before push.
- Use `bun fix` to apply format + lint fixes.

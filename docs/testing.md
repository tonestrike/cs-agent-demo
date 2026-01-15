# Testing

Tests use [Vitest](https://vitest.dev/) with Cloudflare's [`getPlatformProxy`](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy) for Workers environment emulation.

## Running tests

```bash
bun test          # All tests
bun test --watch  # Watch mode
```

## Test structure

All tests run in Node.js environment using [Vitest](https://vitest.dev/):

- **Integration tests** (`*.node.test.ts`): Use `getPlatformProxy` for D1 and Workers bindings
- **Unit tests** (`*.test.ts`): Pure TypeScript/business logic tests

See [`vitest.workspace.ts`](../vitest.workspace.ts).

### Why Node tests for Workers code?

We use `getPlatformProxy` instead of `@cloudflare/vitest-pool-workers` because it works immediately in CI with no setup, handles dependency compatibility issues automatically, and is [officially recommended](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy) for local testing and integration tests.

## Writing tests

### Integration test example

```typescript
import { getPlatformProxy } from "wrangler";

async function createTestEnv() {
  const platform = await getPlatformProxy({
    configPath: "apps/worker/wrangler.toml",
    persist: false,
  });
  await applyMigrations(platform.env.DB);
  return platform;
}

it("creates a ticket", async () => {
  const platform = await createTestEnv();
  try {
    const result = await createTicket(platform.env, { subject: "Test" });
    expect(result).toBeDefined();
  } finally {
    await platform.dispose();
  }
});
```

Each test gets its own isolated environment. See [`router.integration.node.test.ts`](../apps/worker/src/router.integration.node.test.ts) for complete example.

### Unit test example

```typescript
import { applyStatusTransition } from "@pestcall/core";

it("transitions ticket status", () => {
  const result = applyStatusTransition(ticket, "resolved", timestamp);
  expect(result.ok).toBe(true);
});
```

See [`status.test.ts`](../packages/core/src/tickets/status.test.ts).

## Database migrations in tests

Migrations are applied by reading SQL files and executing via D1 API, following [Cloudflare's D1 migration patterns](https://developers.cloudflare.com/d1/reference/migrations/):

```typescript
async function applyMigrations(db: D1Database): Promise<void> {
  const sql = readFileSync("migrations/0001_init.sql", "utf8");
  const statements = sql.split(";").map(s => s.trim()).filter(Boolean);
  
  for (const statement of statements) {
    await db.prepare(`${statement};`).run();
  }
}

async function createTestEnv(): Promise<Platform> {
  const platform = await getPlatformProxy({
    configPath: "apps/worker/wrangler.toml",
    persist: false,
  });
  await applyMigrations(platform.env.DB);
  return platform;
}
```

This runs once per test, ensuring each test starts with a fresh, migrated database.

## Test isolation

Each test creates its own isolated environment:

```typescript
it("creates a ticket", async () => {
  const platform = await createTestEnv();
  try {
    // Test code using platform.env
  } finally {
    await platform.dispose();
  }
});
```

Benefits:
- **True isolation**: Each test gets fresh D1 database via `getPlatformProxy({ persist: false })`
- **Parallel execution**: Tests can run concurrently without conflicts
- **No cleanup needed**: No shared state between tests

See [`router.integration.node.test.ts`](../apps/worker/src/router.integration.node.test.ts) for the `createTestEnv()` helper.

## Timeouts

Long-running tests (D1 operations, wrangler commands) need explicit timeouts:

```typescript
it("applies migrations", async () => {
  // test code
}, { timeout: 30000 }); // 30 seconds
```

Default timeout is 5 seconds.

## References

- [Cloudflare Workers Testing](https://developers.cloudflare.com/workers/testing/)
- [Wrangler API - getPlatformProxy](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy)
- [Vitest Documentation](https://vitest.dev/)
- [Vitest Workspace](https://vitest.dev/guide/workspace)

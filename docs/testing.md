# Testing

Tests use [Vitest](https://vitest.dev/) with Cloudflare's [`getPlatformProxy`](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy) for Workers environment emulation.

## Running tests

```bash
bun run test            # Unit tests
bun run test:integration # Integration tests
bun run test:e2e        # E2E tests (starts local worker)
```

## Test structure

All tests run in Node.js using [Vitest](https://vitest.dev/):

- **Unit tests** (`*.unit.test.ts`): Pure TypeScript/business logic tests
- **Integration tests** (`*.integration.test.ts`): D1 + Workers bindings via `getPlatformProxy`
- **E2E tests** (`*.e2e.test.ts`): Hit a running Worker (local by default)

Config files:
- `vitest.unit.config.ts`
- `vitest.integration.config.ts`
- `vitest.e2e.config.ts`

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

Each test gets its own isolated environment. See [`router.integration.test.ts`](../apps/worker/src/router.integration.test.ts).

### Unit test example

```typescript
import { applyStatusTransition } from "@pestcall/core";

it("transitions ticket status", () => {
  const result = applyStatusTransition(ticket, "resolved", timestamp);
  expect(result.ok).toBe(true);
});
```

See [`status.unit.test.ts`](../packages/core/src/tickets/status.unit.test.ts).

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

See [`router.integration.test.ts`](../apps/worker/src/router.integration.test.ts) for the `createTestEnv()` helper.

## Timeouts

Long-running tests (D1 operations, wrangler commands) need explicit timeouts:

```typescript
it("applies migrations", async () => {
  // test code
}, { timeout: 30000 }); // 30 seconds
```

Default timeout is 5 seconds.

## E2E runner

`bun run test:e2e` starts a local worker via `wrangler dev --local` and runs the e2e suite.
Set `E2E_BASE_URL` to target a deployed worker instead.

## References

- [Cloudflare Workers Testing](https://developers.cloudflare.com/workers/testing/)
- [Wrangler API - getPlatformProxy](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy)
- [Vitest Documentation](https://vitest.dev/)
- [Vitest Workspace](https://vitest.dev/guide/workspace)

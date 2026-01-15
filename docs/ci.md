# Continuous Integration

CI runs on every push and pull request using [GitHub Actions](https://docs.github.com/en/actions).

## Workflow

See [`.github/workflows/ci.yml`](../.github/workflows/ci.yml):

```yaml
- bun install
- bun lint       # Biome, oxlint, cspell
- bun typecheck  # TypeScript compilation
- bun test       # All tests via Vitest
```

## Test environment

Tests run in Ubuntu with:
- Bun 1.1.0 (matches `package.json` packageManager)
- Node.js modules for Workers emulation
- Ephemeral D1 databases via `getPlatformProxy`

No special setup required. Wrangler automatically:
1. Downloads `workerd` binary (Cloudflare Workers runtime)
2. Creates temporary D1 databases
3. Provides Workers bindings

See [Cloudflare Workers CI documentation](https://developers.cloudflare.com/workers/testing/integration-testing/#ci-cd).

## Why it works

The test setup uses Cloudflare's official [`getPlatformProxy` API](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy):

```typescript
const platform = await getPlatformProxy({
  configPath: "apps/worker/wrangler.toml",
  persist: false,
});
```

This runs in Node.js (not Workers runtime) but emulates Workers bindings. Perfect for CI because:
- No external dependencies
- Fast startup
- Automatic cleanup via `dispose()`

## Dependency compatibility

Some npm packages use CommonJS patterns incompatible with Workers runtime. We handle this in [`vitest.workspace.ts`](../vitest.workspace.ts):

```typescript
resolve: {
  alias: {
    ajv: false, // Incompatible dependency not used in tests
  },
},
```

This prevents Vitest from trying to bundle incompatible code. Tests run in Node environment where these dependencies don't load.

## Local vs CI

Tests behave identically:
- Same Bun version
- Same Wrangler version
- Same test commands
- Same isolation model

If tests pass locally, they pass in CI.

## Performance

Typical CI run: ~20-30 seconds
- Install: ~2s
- Lint: ~1s
- Typecheck: ~1s
- Tests: ~5s (including D1 migrations)

D1 migration tests are slowest. They use 30-second timeout:

```typescript
it("migrates database", async () => {
  // test code
}, { timeout: 30000 });
```

## References

- [GitHub Actions Workflow Syntax](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions)
- [Cloudflare Workers Testing](https://developers.cloudflare.com/workers/testing/)
- [Wrangler getPlatformProxy](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy)
- [Vitest Configuration](https://vitest.dev/config/)

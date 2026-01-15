# PestCall

AI-powered customer service agent for pest control with ticketing, call traces, and a worker-first API.

## Requirements

- Bun
- Wrangler (installed via dev deps)

## Quick start

1. Install dependencies:

```sh
bun install
```

2. Create environment file:

```sh
cp .env.example .env
```

Create web environment file (for API base URL + auth token):

```sh
cp apps/web/.env.example apps/web/.env.local
```

3. Run local D1 migrations:

```sh
bun db:migrate:local
```

4. Run tests:

```sh
bun run test
bun run test:integration
bun run test:e2e
```

## Local dev (Worker)

Run the Worker with local bindings:

```sh
cd apps/worker
cp .dev.vars.example .dev.vars
wrangler dev --local
```

RPC endpoints are served under `/rpc`.
Customize tone and scope via `AGENT_TONE`, `AGENT_GREETING`, and `AGENT_OFFTOPIC_MESSAGE` in `apps/worker/.dev.vars`.

## Local dev (Web)

```sh
cd apps/web
bun dev
```

Set `NEXT_PUBLIC_API_BASE_URL` to your Worker URL (local or deployed).

## Deploy (Worker)

Use the scripted deploy to create the D1 database if missing, apply migrations, and deploy:

```sh
bun deploy:worker
```

Seed demo data with:

```sh
bun deploy:worker --seed
```

## Database layout

- Migrations live in `apps/worker/migrations`.
- Seeds live in `apps/worker/seeds`.
- Naming convention: `YYYYMMDDHHMMSS_description.sql` (full timestamp, lowercase snake).
- Keep seed data small and deterministic for local demos.

## Useful commands

- `bun lint`
- `bun format`
- `bun typecheck`
- `bun run test`
- `bun run test:integration`
- `bun run test:e2e`
- `bun db:migrate:local`

## Repo layout

- `apps/worker` Cloudflare Worker API (oRPC)
- `apps/web` Next.js UI (customer portal + agent dashboard)
- `packages/core` shared domain logic and types
- `docs/` project documentation

## Documentation

- [Testing](docs/testing.md) - Test structure and best practices
- [CI/CD](docs/ci.md) - Continuous integration setup
- [Styleguide](docs/styleguide.md) - Code style and patterns
- [Documentation Styleguide](docs/docs-styleguide.md) - How to write docs
- [MCP Setup](docs/mcp/README.md) - Model Context Protocol servers (Postman, Serena, Context7)
- [Postman Setup](postman/README.md) - API testing with Postman collections and environments

## AI Coding Tools

This project uses [rulesync](https://github.com/dyoshikawa/rulesync) to maintain consistent AI coding assistant rules across multiple tools (Claude Code, Cursor, GitHub Copilot, Codex CLI).

**After cloning or pulling changes to `.rulesync/`, sync your AI tool configurations:**

```sh
bun run sync:rules
```

This generates tool-specific configuration files (`.claude/`, `.cursor/`, etc.) from the shared rules in `.rulesync/`. Generated files are git-ignored and created locally for each developer.

**To update team rules**: Edit files in `.rulesync/`, commit them, and other team members run `bun run sync:rules` to get the updates.

See [`.rulesync/README.md`](.rulesync/README.md) for more details.

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

3. Run local D1 migrations:

```sh
bun db:migrate:local
```

4. Run tests:

```sh
bun run test
```

## Local dev (Worker)

Run the Worker with local bindings:

```sh
cd apps/worker
wrangler dev --local
```

RPC endpoints are served under `/rpc`.

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
- `bun db:migrate:local`

## Repo layout

- `apps/worker` Cloudflare Worker API (oRPC)
- `apps/web` Next.js UI (future)
- `packages/core` shared domain logic and types

## AI Coding Tools

This project uses [rulesync](https://github.com/dyoshikawa/rulesync) to maintain consistent AI coding assistant rules across multiple tools (Claude Code, Cursor, GitHub Copilot, Codex CLI).

**After cloning or pulling changes to `.rulesync/`, sync your AI tool configurations:**

```sh
bun run sync:rules
```

This generates tool-specific configuration files (`.claude/`, `.cursor/`, etc.) from the shared rules in `.rulesync/`. Generated files are git-ignored and created locally for each developer.

**To update team rules**: Edit files in `.rulesync/`, commit them, and other team members run `bun run sync:rules` to get the updates.

See [`.rulesync/README.md`](.rulesync/README.md) for more details.

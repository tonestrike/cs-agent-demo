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

# PestCall

AI-powered customer service agent for pest control, built on Cloudflare Workers. Handles customer verification, appointment management, billing inquiries, and ticket creation through voice and chat interfaces.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/)
- Wrangler (installed via dev deps)

### Setup

```sh
bun install
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
bun db:migrate:local
bun db:seed:local
```

### Run

```sh
bun dev
```

Entry points:
- `/customer` - Realtime chat interface
- `/agent` - Agent dashboard

## Architecture

### Monorepo Structure

```
apps/worker/     Cloudflare Worker API (Hono.js + oRPC)
apps/web/        Next.js 14 UI (customer portal + agent dashboard)
packages/core/   Shared domain logic and Zod schemas
```

### Request Flow

Routes -> Use-cases -> Repositories -> D1/CRM

The agent uses Durable Objects for session management with a strict separation between generic orchestration (`v2/session.ts`) and domain logic (providers).

For detailed architecture, see [docs/ai-agent-architecture.md](docs/ai-agent-architecture.md).

## Development Commands

```sh
# Development
bun dev                    # Run worker + web concurrently

# Quality checks
bun qa                     # Full suite: typecheck + lint + format:check + tests
bun typecheck              # TypeScript compilation check
bun lint                   # Lint with Biome
bun fix                    # Auto-fix format + lint issues

# Testing
bun test                   # Unit tests
bun test:integration       # Integration tests with D1
bun test:e2e               # E2E tests against local worker

# Database
bun db:migrate:local       # Apply D1 migrations locally
bun db:seed:local          # Seed local D1 with demo data
```

## Evaluation System

Run conversation evaluations to assess bot quality:

```sh
bun run scripts/run-analyzer.ts --category <category> --with-analysis --save
```

Categories: `verification`, `reschedule`, `cancel`

For details on using evaluations to improve the system, see [docs/evaluation-improvement-guide.md](docs/evaluation-improvement-guide.md).

## Deployment

```sh
bun deploy:worker          # Deploy worker (creates DB, applies migrations)
bun deploy:worker --seed   # Deploy + seed demo data
bun logs:worker            # Tail worker logs
```

### Model Providers

Supports Workers AI and OpenRouter (via Cloudflare AI Gateway). Set `AGENT_MODEL` in `.dev.vars` to switch providers.

## Documentation

- [AI Agent Architecture](docs/ai-agent-architecture.md) - Agent design (source of truth)
- [Styleguide](docs/styleguide.md) - Code patterns and conventions
- [Testing](docs/testing.md) - Test structure and setup
- [Evaluation Improvement Guide](docs/evaluation-improvement-guide.md) - Using evaluations to improve the bot
- [CI/CD](docs/ci.md) - Continuous integration setup

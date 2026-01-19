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

**Entry points:**
- `/customer` - Customer-facing realtime chat interface
- `/agent` - Internal dashboard (calls, prompts, company knowledge, tickets)

---

## Understanding This Codebase

### For New Reviewers

Start with these docs in order:

1. **[AI Agent Architecture](docs/ai-agent-architecture.md)** - The main document. Covers:
   - Repository structure and where to find things
   - How conversations flow from UI to AI to tools
   - Model strategy (Workers AI vs OpenRouter, dual-model approach)
   - Prompt design philosophy and why we made specific choices
   - Tool system, gating, and handlers
   - Acknowledgements for latency optimization
   - RAG for company knowledge
   - Known issues and limitations
   - Lessons learned and what we'd do differently

2. **[Evaluation Improvement Guide](docs/evaluation-improvement-guide.md)** - How to use the evaluation system to test and improve the bot.

### Quick Reference

| What you need | Where to look |
|---------------|---------------|
| Main agent logic | `apps/worker/src/durable-objects/conversation-session/v2/session.ts` |
| Tool definitions | `apps/worker/src/models/tool-definitions.ts` |
| Tool handlers | `apps/worker/src/durable-objects/conversation-session/tool-flow/handlers/` |
| Prompt building | `apps/worker/src/durable-objects/conversation-session/v2/providers/prompt-provider.ts` |
| Evaluation scenarios | `apps/worker/src/analyzer/scenarios/` |
| Customer chat UI | `apps/web/src/app/customer/` |

---

## Architecture Overview

### Monorepo Structure

```
apps/worker/     Cloudflare Worker API (Hono.js + oRPC)
apps/web/        Next.js 14 UI (customer portal + agent dashboard)
packages/core/   Shared domain logic and Zod schemas
```

### Request Flow

```
Routes → Use-cases → Repositories → D1/CRM
```

The agent uses **Durable Objects** for stateful conversations with a strict separation:
- **Generic Agent Layer** (`v2/session.ts`) - WebSocket, model calls, event streaming
- **Configuration Layer** (`providers/`) - Tool definitions, prompts, domain logic

See [AI Agent Architecture](docs/ai-agent-architecture.md) for details.

---

## Development Commands

```sh
# Development
bun dev                    # Run worker + web concurrently

# Quality checks
bun qa                     # Full suite: typecheck + lint + format + tests
bun typecheck              # TypeScript compilation check
bun lint                   # Lint with Biome
bun fix                    # Auto-fix format + lint issues

# Testing
bun test                   # Unit tests
bun test:integration       # Integration tests with D1
bun test:e2e               # E2E tests (requires worker running)

# Database
bun db:migrate:local       # Apply D1 migrations locally
bun db:seed:local          # Seed local D1 with demo data
```

---

## Evaluation System

The evaluation system tests bot quality by running scenarios and scoring with AI.

```sh
bun run scripts/run-analyzer.ts --category <category> --with-analysis --save
```

**Categories:** `verification`, `reschedule`, `cancel`

**Key insight:** Pass/fail is NOT the same as quality. A scenario can "pass" while having a terrible conversation. Always check AI scores (0-100) and read transcripts.

See [Evaluation Improvement Guide](docs/evaluation-improvement-guide.md) for details.

---

## Deployment

```sh
bun deploy:worker          # Deploy worker (creates DB, applies migrations)
bun deploy:worker --seed   # Deploy + seed demo data
bun logs:worker            # Tail worker logs
```

### Model Providers

Supports Workers AI (default) and OpenRouter (via Cloudflare AI Gateway). Set `AGENT_MODEL` in `.dev.vars` to switch.

---

## Documentation Index

### Architecture & Design
- **[AI Agent Architecture](docs/ai-agent-architecture.md)** - Comprehensive guide (start here)

### Development
- [Styleguide](docs/styleguide.md) - Code patterns and conventions
- [Testing](docs/testing.md) - Test structure and setup
- [CI/CD](docs/ci.md) - Continuous integration

### Evaluation
- [Evaluation Improvement Guide](docs/evaluation-improvement-guide.md) - Using evaluations to improve the bot
- [Evaluation Issues](docs/evaluation-issues/) - Tracked issues by category

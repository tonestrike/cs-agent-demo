---
root: true
targets: ["*"]
description: "CS-Agent project overview and development guidelines for a Cloudflare Workers-based customer success agent"
globs: ["**/*"]
---

# CS-Agent Project Overview

PestCall is an AI-powered customer service agent for pest control, built on Cloudflare Workers. It handles customer verification, appointment management (reschedule/cancel), billing inquiries, and ticket creation through voice and chat interfaces.

## Common Commands

```bash
# Development
bun dev                    # Run worker + web concurrently
bun db:migrate:local       # Apply D1 migrations locally
bun db:seed:local          # Seed local D1 with demo data

# Quality checks (run before pushing)
bun qa                     # Full suite: typecheck + lint + format:check + all tests
bun typecheck              # TypeScript compilation check
bun lint                   # Lint with Biome
bun fix                    # Auto-fix format + lint issues

# Testing
bun test                   # Unit tests (*.unit.test.ts)
bun test:integration       # Integration tests with D1 (*.integration.test.ts)
bun test:e2e               # E2E tests against local worker (*.e2e.test.ts)

# Run a single test file
bunx vitest run path/to/file.unit.test.ts -c vitest.unit.config.ts
bunx vitest run path/to/file.integration.test.ts -c vitest.integration.config.ts

# Deployment
bun deploy:worker          # Deploy worker (creates DB, applies migrations)
bun deploy:worker --seed   # Deploy + seed demo data
bun logs:worker            # Tail worker logs

# AI tool config (run after pulling changes to .rulesync/)
bun sync:rules             # Regenerate Claude/Cursor/Copilot configs

# Conversation Analyzer (evaluation)
bun run scripts/run-analyzer.ts --category <category> --with-analysis --save
# Categories: verification, reschedule, cancel
```

## Architecture

### Monorepo Structure

- `apps/worker/` - Cloudflare Worker API (Hono.js + oRPC)
- `apps/web/` - Next.js 14 UI (customer portal + agent dashboard)
- `packages/core/` - Shared domain logic and Zod schemas (no Cloudflare bindings)

### Request Flow Pattern

Routes → Use-cases → Repositories → D1/CRM

- **Routes** (`apps/worker/src/routes/`): Thin handlers, validate with Zod, call use-cases
- **Use-cases** (`apps/worker/src/use-cases/`): Business logic orchestration
- **Repositories** (`apps/worker/src/repositories/`): D1 database access abstraction
- **Context** (`apps/worker/src/context.ts`): Dependency injection via `createContext(env)`

### Agent Architecture (Durable Objects)

The agent uses a strict separation between generic orchestration and domain logic:

**Generic Agent Layer** (`apps/worker/src/durable-objects/conversation-session/v2/`):
- `session.ts` - Coordinator, WebSocket handling, model calls
- `state.ts` - Session state management
- `events.ts` - Event streaming and buffer for resync
- No domain concepts - treats `domainState` as opaque `Record<string, unknown>`

**Configuration Layer** (domain-specific):
- `providers/tool-provider.ts` - Tool definitions, gating rules, acknowledgements
- `providers/prompt-provider.ts` - Context-aware prompt building
- `models/tool-definitions.ts` - Tool schemas with Zod

**Constraint**: The agent layer must never contain domain-specific types. Logic like "is customer verified" or "has appointments" belongs in providers, not session.ts.

### Tool Flow

- Definitions: `apps/worker/src/models/tool-definitions.ts`
- Handlers: `apps/worker/src/durable-objects/conversation-session/tool-flow/registry.ts`
- Workflows (cancel/reschedule): `apps/worker/src/workflows/`

## Key Patterns

### Zod Schemas as Source of Truth
```typescript
// Define schema, infer type
const customerSchema = z.object({ id: z.string(), name: z.string() });
type Customer = z.infer<typeof customerSchema>;
```

### Multiline Strings (for prompts)
```typescript
// Use arrays joined with newlines, not template literals
const lines = [
  "First line",
  `Dynamic: ${value}`,
  "",
  "Section header",
];
return lines.join("\n");
```

### Type Safety
- Avoid inline casts like `(args as Type).field`
- Use Zod `.parse()` for runtime validation
- Use discriminated unions with type guards
- Validate tool args at dispatch time

### Testing
- Integration tests use `getPlatformProxy` for Worker emulation with isolated D1
- Each test gets fresh database via `persist: false`
- Long-running tests need explicit timeouts: `{ timeout: 30000 }`

## Conversation Analyzer (Evaluation System)

The analyzer evaluates bot conversation quality against defined scenarios.

**Key files:**
- `scripts/run-analyzer.ts` - CLI for running evaluations
- `apps/worker/src/analyzer/evaluator.ts` - AI analysis using Workers AI
- `apps/worker/src/analyzer/best-practices.ts` - Scoring criteria and best practices

**Understanding results:**
- **Pass/Fail**: Whether step expectations matched (patterns, tool calls, state changes)
- **AI Score**: True quality metric (0-100, strict scoring)

**Critical insight**: Pass/fail is NOT the same as conversation quality. A scenario can "pass" while having a terrible conversation. Always check AI scores and read transcripts.

See [Evaluation Improvement Guide](../../docs/evaluation-improvement-guide.md) for how to use evaluation results to improve the system.

## Database

Migrations: `apps/worker/migrations/` (format: `YYYYMMDDHHMMSS_description.sql`)

Key tables: `call_sessions`, `call_turns`, `customers_cache`, `appointments`, `tickets`, `agent_prompt_config`

## Documentation

- [Styleguide](../../docs/styleguide.md) - Code patterns and conventions
- [Testing](../../docs/testing.md) - Test structure and setup
- [AI Agent Architecture](../../docs/ai-agent-architecture.md) - Agent design (source of truth)
- [Documentation Styleguide](../../docs/docs-styleguide.md) - How to write docs
- [Evaluation Improvement Guide](../../docs/evaluation-improvement-guide.md) - Using evaluations to improve the bot

### Evaluation Issues (tracked problems)
- [Verification Issues](../../docs/evaluation-issues/verification-issues.md)
- [Cancel Issues](../../docs/evaluation-issues/cancel-issues.md)
- [Architectural Issues](../../docs/evaluation-issues/architectural-issues.md) - Butt-in, response format, seeding

# PestCall Demo Plan

## Goals
- Demo an AI customer service flow for pest control.
- Identify caller by phone number, answer appointment/billing questions, and escalate to tickets.
- Provide ticketing and call trace UI for operators.

## Current State
- Monorepo scaffold with Bun, TS, Biome, Vitest.
- D1 schema and local migrations in `apps/worker/migrations`.
- oRPC Worker API with tickets, calls, CRM (mock) routes.
- Core domain for tickets and CRM schemas (Zod as source of truth).
- Integration tests for D1 and Worker RPC.

## Key Decisions
- Cloudflare-first architecture (Workers, D1, KV, Durable Objects).
- oRPC for typed API, Zod for schema validation.
- Dependency injection via context factory (simple function-based DI).
- Repositories + use-cases for logic reuse.

## Mock CRM Fixtures
- Two customers, appointments, invoices, and available slots.
- Mock adapter used by default via `CRM_PROVIDER=mock`.

## Next Work Items
1) Add CRM integration tests (lookup, appointment, invoices, slots).
2) Agent HTTP loop with tool calls + D1 tracing.
3) Durable Object for call session state.
4) Next.js UI (tickets, calls, agent playground).

## Local Commands
- Install: `bun install`
- Migrate: `bun db:migrate:local`
- Tests: `bun run test`
- Worker dev: `cd apps/worker && wrangler dev --local`

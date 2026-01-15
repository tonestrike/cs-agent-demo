# PestCall Demo Plan

AI-powered customer service agent for pest control with ticketing, call traces, and a worker-first API.

## Current State
- Bun + TypeScript + Biome + Vitest scaffold.
- D1 migrations and local seeding in `apps/worker/migrations` and `apps/worker/seeds`.
- oRPC Worker API: tickets, calls, CRM mock, and agent RPC.
- Agent use-case logs call sessions and turns in D1.
- CRM mock fixtures with appointments/invoices for demos.
- Agents SDK wired with `PestCallAgent` Durable Object and WebSocket handling. See [`pestcall.ts`](../apps/worker/src/agents/pestcall.ts).
- Model adapter scaffold with mock tool-calling loop in [`models`](../apps/worker/src/models/).

## Near-Term Plan
- Add model adapter (Workers AI first) and tool-calling loop.
- Include compact state summaries in prompts and tool-call logs in D1.
- Add agent playground in the web UI for HTTP + WebSocket flows.
- Expand call trace UI to show tool latency and failures.

## Demo Flow
1) Caller identified by phone.
2) Appointment/billing answered.
3) Ticket created on escalation or failure.
4) Call trace visible in UI.

## Local Commands
- `bun install`
- `bun db:migrate:local`
- `bun db:seed:local`
- `bun run test`
- `cd apps/worker && wrangler dev --local`

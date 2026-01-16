# PestCall Demo Plan

AI-powered customer service agent for pest control with ticketing, call traces, and a worker-first API.

## Intention
Make the agent conversational and model-led. Use the model for orchestration (tool choice, follow-ups, ticket creation) while keeping only minimal safety guardrails and identity gating in code.

## Current State
- Bun + TypeScript + Biome + Vitest scaffold.
- D1 migrations and local seeding in `apps/worker/migrations` and `apps/worker/seeds`.
- oRPC Worker API: tickets, calls, CRM mock, and agent RPC.
- Agent use-case logs call sessions and turns in D1.
- CRM mock fixtures with appointments/invoices for demos.
- Agents SDK wired with `PestCallAgent` Durable Object and WebSocket handling. See [`pestcall.ts`](../apps/worker/src/agents/pestcall.ts).
- Model adapter scaffold with mock tool-calling loop in [`models`](../apps/worker/src/models/).

## Near-Term Plan
- Shift orchestration into the model (tool choice, follow-ups, ticket creation).
- Reduce deterministic branching in the agent use-case to minimal guardrails.
- Add identity confirmation state to context and gate sensitive tools on it.
- Provide richer context to the model (compact summary, last turns, last tool result, identity status).
- Improve session management so old conversations are easy to resume.

## Demo Flow
1) Caller identified by phone and confirmed identity in context.
2) Model handles conversation flow (clarifying questions, appointment/billing, reschedule).
3) Model decides if/when to create tickets.
4) Call trace and tool results visible in UI.

## Tasks
1) Update prompts to allow conversational responses and model-led tool selection.
2) Expand tool surface to include appointment slots and ticket creation as model-initiated actions.
3) Add identity confirmation state to call session context and enforce it before sensitive tools.
4) Replace full-turn context with a structured summary + last turns + last tool result.
5) Improve session lookup/resume flow on the client and worker.

## Local Commands
- `bun install`
- `bun db:migrate:local`
- `bun db:seed:local`
- `bun run test`
- `cd apps/worker && wrangler dev --local`

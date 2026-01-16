# PestCall Demo Plan

AI-powered customer service agent for pest control with ticketing, call traces, and a worker-first API.

## Intention
Make the agent conversational and model-led. Use the model for orchestration (tool choice, follow-ups, ticket creation) while keeping only minimal safety guardrails and identity gating in code.
Broaden model selection to the full Cloudflare Workers AI catalog so prompt tuning and behavior testing are not bottlenecked by a short list.

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
- Expand the model dropdown to include all Cloudflare Workers AI models supported for agents.

## Demo Flow
1) Caller identified by phone and confirmed identity in context.
2) Model handles conversation flow (clarifying questions, appointment/billing, reschedule).
3) Model decides if/when to create tickets.
4) Call trace and tool results visible in UI.

## Current Gaps (Why the experience feels constrained)
- Deterministic branching in `apps/worker/src/use-cases/agent.ts` handles intent detection, reschedule logic, ZIP checks, and ticket creation before the model sees the full context.
- Tool coverage is narrower than the actual flow (e.g. available slots and ticket creation are not model-initiated), so the model cannot own the orchestration.
- Context passed to the model is a raw concatenation of turns without a structured summary, identity status, or last tool result.
- Session continuity depends on the client always providing `callSessionId`, so missing IDs cause fresh sessions and repeated greetings.
- Prompts explicitly constrain the response length and structure, limiting conversational follow-ups.

## Target Behavior
- The model determines what to do next (ask, call tool, or respond), with guardrails only for identity and high-risk data.
- Tools are the only source of business logic; the orchestration layer is thin and generic.
- Context includes a short summary, last N turns, identity verification status, and last tool call/result.
- The agent can continue multi-turn flows without restarting or repeating greetings.

## Technical Plan (Implementation Details)
1) **Tool surface expansion**
   - Add tools for all supported actions: customer lookup, appointment lookup, available slots, reschedule, open invoices, and ticket creation.
   - Remove ad hoc logic that performs these steps outside of model decisions.
   - Ensure each tool call records latency, success, and errors in call turn metadata.

2) **Model-led orchestration**
   - Replace deterministic intent and regex checks with a single model decision step.
   - The model chooses either a tool call or a direct response.
   - After each tool call, return the tool result to the model for the final response.

3) **Identity gating**
   - Introduce an explicit `identity` state in call session context (`status: unknown | pending | verified`).
   - Only allow sensitive tools (billing details, rescheduling, ticket creation) when `status === verified`.
   - Provide a lightweight verification tool or message pattern for the model to request ZIP/name confirmation.

4) **Context packaging**
   - Store a rolling summary on the call session (e.g. last resolved request, verified identity, last tool used).
   - Pass a structured context block to the model:
     - `summary`
     - `identityStatus`
     - `lastToolCall`
     - `lastToolResult`
     - `recentTurns` (last N turns, not full history)

5) **Session management**
   - Persist `callSessionId` on the client and reuse it automatically for new messages.
   - Add a server-side lookup by phone number to resume the most recent active session.
   - Expose a “resume previous session” option in the UI.

6) **Prompt updates**
   - Remove tight response limits (e.g. 1–2 sentences).
   - Clarify that the model should ask follow-ups and call tools as needed.
   - Keep safety language minimal and focused on identity gating.

## Tasks
1) Update prompts to allow conversational responses and model-led tool selection.
2) Expand tool surface to include appointment slots and ticket creation as model-initiated actions.
3) Add identity confirmation state to call session context and enforce it before sensitive tools.
4) Replace full-turn context with a structured summary + last turns + last tool result.
5) Improve session lookup/resume flow on the client and worker.
6) Populate the model dropdown from the full Workers AI model list and store the selected model ID.

## Local Commands
- `bun install`
- `bun db:migrate:local`
- `bun db:seed:local`
- `bun run test`
- `cd apps/worker && wrangler dev --local`

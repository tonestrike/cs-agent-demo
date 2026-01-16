# PestCall Demo Plan

AI-powered customer service agent for pest control with ticketing, call traces, and a worker-first API.

## Intention
Make the agent conversational and model-led. The model should orchestrate tool usage and follow-ups, while code keeps only minimal, programmatic guardrails (identity gating and tool execution).
Broaden model selection to the full Cloudflare Workers AI catalog so prompt tuning and behavior testing are not bottlenecked by a short list.

## Current State
- Bun + TypeScript + Biome + Vitest scaffold.
- D1 migrations and local seeding in `apps/worker/migrations` and `apps/worker/seeds`.
- oRPC Worker API: tickets, calls, CRM mock, and agent RPC.
- Agent use-case logs call sessions and turns in D1, including summary metadata.
- CRM mock fixtures with appointments/invoices for demos.
- Agents SDK wired with `PestCallAgent` Durable Object and WebSocket handling. See [`pestcall.ts`](../apps/worker/src/agents/pestcall.ts).
- Model adapter with tool-calling loop in [`models`](../apps/worker/src/models/).
- Call summaries stored on call sessions and surfaced in the UI.
- Calls, tickets, and appointments include customer context in list results (name, phone, address).
- Customer dashboard and customer detail views have tabbed sections.

## Current Reality (What We Learned)
- The model often replies with "I'll check..." without issuing a tool call, so the loop stops.
- Verification still fails in some paths because the model claims success without calling `crm.verifyAccount`.
- Invalid ZIP input (non-5 digit) leads to confusing handoffs unless the system enforces ZIP validation.
- The orchestration loop needs a better separation between "decision" and "response" to avoid dead ends.
- Context handling is still brittle when the model treats turns as new sessions or reintroduces itself.
- UI now exposes more data, but the agent loop needs a refactor to be more deterministic in *execution* while keeping orchestration model-led.

## Demo Flow
1) Caller identified by phone and confirmed identity in context.
2) Model handles conversation flow (clarifying questions, appointment/billing, reschedule).
3) Model decides if/when to create tickets.
4) Call trace and tool results visible in UI.

## Current Gaps (Why the experience still breaks)
- The loop ends when the model returns a final response that implies action but does not issue a tool call.
- Verification claims can happen without `crm.verifyAccount` in some model replies.
- Error handling for invalid ZIPs needs to be consistent and fast (no asking for phone/name).
- The model sometimes reintroduces itself or restarts flow when context should persist.
- Mixed responsibilities: some tool routing logic still lives in code, while other paths rely on model inference.

## Observed Issues (From Current Runs)
- High latency due to multiple model calls per user turn.
- No response or blank response on some turns.
- Final responses that promise action but never call tools.
- Tool calls happen, but results are not always used to generate the next response.
- Verification language appears without a completed `crm.verifyAccount`.
- Invalid ZIP inputs lead to unexpected follow-ups (name/phone).
- Tool names occasionally leak into responses.

## Target Behavior
- The model determines what to do next (ask, call tool, or respond), with guardrails only for identity and high-risk data.
- Tools are the only source of business logic; the orchestration layer is thin and generic.
- Context includes a short summary, last N turns, identity verification status, and last tool call/result.
- The agent can continue multi-turn flows without restarting or repeating greetings.

## Refactor Direction (Reset Plan)
1) **Two-step orchestration**
   - Step 1: Model returns a tool call or a final response.
   - Step 2: If the response implies action but has no tool call, force a second model decision for a tool call.
   - Do not parse intents in code; only gate tool execution programmatically.

2) **Verification as middleware**
   - Verification state is stored in the call session summary.
   - Only allow non-verification tools when `identityStatus === verified`.
   - ZIP validation is programmatic (Zod 5-digit check) before `crm.verifyAccount`.
   - No name or phone confirmations while unverified.

3) **Tool-only business logic**
   - Move any “fetch” or “check” to tools only.
   - The agent should never claim it checked something without a tool result.

4) **Context + logging**
   - Add a debug context endpoint (`calls/context`) to inspect decisions and last turn metadata.
   - Log model decision snapshots and tool call sources for each turn.
   - Use these logs to trace “no follow-on tool call” failures.

5) **UI + data model alignment**
   - Calls/tickets/appointments include customer context in list responses.
   - Customer detail uses tabs for calls/tickets/appointments.
   - Call summaries are stored and rendered on call list cards.

## Docs References (Cloudflare Agents)
- [Agents Patterns](https://developers.cloudflare.com/agents/patterns/)
- [Human-in-the-Loop Guide](https://developers.cloudflare.com/agents/guides/human-in-the-loop/)
- [Agents API Reference](https://developers.cloudflare.com/agents/api-reference/agents-api/)
- [Using AI Models](https://developers.cloudflare.com/agents/api-reference/using-ai-models/)
- [WebSockets](https://developers.cloudflare.com/agents/api-reference/websockets/)
- [Store and Sync State](https://developers.cloudflare.com/agents/api-reference/store-and-sync-state/)

## Best-Practice Notes (From Docs)
- Centralize tool definitions with Zod input schemas; use structured tool calls instead of parsing tools from free-form text.
- Prefer AI SDK tool definitions with input/output schemas to validate tool usage end-to-end.
- Separate decision (tool call vs final response) from response generation; prefer prompt chaining for deterministic steps.
- Distinguish auto-executed tools from confirmation-required tools (human-in-the-loop).
- Keep session state close to the Agent instance when possible to reduce round trips.
- Stream long-running model output over WebSockets when latency matters.
- Persist short-lived state for follow-up actions (last appointment, last available slots) so confirmations resolve deterministically.

## Tasks (Next Pass)
1) Simplify orchestration to a two-step model decision with fallback decision on action commitments.
2) Centralize verification gating and remove any non-tool "verification" language.
3) Improve the debug view to show decision snapshots, tool call sources, and verification state.
4) Remove remaining deterministic branches that simulate intent resolution.
5) Add test coverage for “final reply with action but no tool call”.

## Local Commands
- `bun install`
- `bun db:migrate:local`
- `bun db:seed:local`
- `bun run test`
- `cd apps/worker && wrangler dev --local`

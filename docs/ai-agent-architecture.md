# AI agent architecture

This document explains how the PestCall AI agent interprets input, calls tools, and responds while keeping context. It also clarifies what logic lives in prompts vs code.

## Core responsibilities

The agent handles four responsibilities:
- Interpret the user input and infer intent.
- Decide which tools to call.
- Interpret tool outputs.
- Respond to the customer organically.

The prompt controls the behavior. Code provides tools and guardrails, not deterministic responses.

## Prompt ownership and storage

Prompts and tone live in D1 so you can change behavior without deployments.
- Source of truth: `agent_prompt_config` table. See migration [`20250201200000_agent_prompt_config.sql`](../apps/worker/migrations/20250201200000_agent_prompt_config.sql) and additions in [`20250201203000_agent_prompt_config_additions.sql`](../apps/worker/migrations/20250201203000_agent_prompt_config_additions.sql).
- Repository: [`agent-config.ts`](../apps/worker/src/repositories/agent-config.ts).
- RPC API: [`agent-config.ts`](../apps/worker/src/routes/agent-config.ts).
- UI editor: Prompt Studio in [`page.tsx`](../apps/web/src/app/agent/page.tsx).

Editable prompt fields:
- `personaSummary`: high-level role and personality.
- `scopeMessage`: what the agent can help with.
- `toolGuidance.*`: per-tool behavior guidance.
- `modelId`: model variant to use.

## Tool orchestration flow

The agent decides tool calls, then uses tool outputs to respond. See [`agent.ts`](../apps/worker/src/use-cases/agent.ts).

High-level flow:
- Load the prompt config from D1.
- Build a model adapter with that config.
- Send user input + conversation context to the model.
- If the model selects a tool, call the tool.
- Send tool result back to the model for a response.

## Context handling

Context is passed into the model as a serialized conversation summary.
- The worker reads recent turns from D1. See [`calls.ts`](../apps/worker/src/repositories/calls.ts).
- The model adapter receives the context text. See [`workers-ai.ts`](../apps/worker/src/models/workers-ai.ts).

If you want full-thread context instead of recent turns, increase the turn window in [`agent.ts`](../apps/worker/src/use-cases/agent.ts) or move the rolling context into a durable object.

## Guardrails (code vs prompt)

The code enforces safety and data rules:
- Customer verification (ZIP) before billing details.
- Ticket creation when escalation is required.

The prompt controls tone, phrasing, and how the agent explains itself. See [`workers-ai.ts`](../apps/worker/src/models/workers-ai.ts).

## Model selection

Model selection is stored in prompt config as `modelId`, and the model adapter reads it. See [`models/index.ts`](../apps/worker/src/models/index.ts).

The current UI exposes a curated list. Expand the list after confirming model IDs from Cloudflare.

## Cloudflare references

Use these references when updating agent behavior or transport:
- Cloudflare Agents: `https://developers.cloudflare.com/agents/`
- Cloudflare Realtime: `https://developers.cloudflare.com/realtime/`

These are not linked per the docs styleguide. Copy the URLs as needed.

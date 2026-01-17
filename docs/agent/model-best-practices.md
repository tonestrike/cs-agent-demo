# Model best practices
Keep the model in control of language and intent. Keep tools deterministic and validated. This doc summarizes the current prompt contract and how to extend it safely.

## Core loop
- Tool selection happens in the model adapters. See [`openrouter.ts`](../../apps/worker/src/models/openrouter.ts) and [`workers-ai.ts`](../../apps/worker/src/models/workers-ai.ts).
- The durable object executes tools and passes results to the narrator. See [`conversation-session.ts`](../../apps/worker/src/durable-objects/conversation-session.ts) and the flow overview in [`conversation-session.md`](./conversation-session.md).
- Tool schemas and validation live in [`tool-definitions.ts`](../../apps/worker/src/models/tool-definitions.ts) and [`types.ts`](../../apps/worker/src/models/types.ts).

## Prompt contract (current spec)
- Use tool calls for actions, and plain text for everything else. The model adapters enforce this in their system prompts.
- Narrator responses must use only tool results. Do not invent times, addresses, or statuses. The prompt explicitly bans internal IDs and tool names.
- Structured outputs are required for routing and tool calls. See JSON mode guards in [`workers-ai.ts`](../../apps/worker/src/models/workers-ai.ts) and [`openrouter.ts`](../../apps/worker/src/models/openrouter.ts).
- Tool guidance strings come from config. Keep them current in [`schemas.ts`](../../packages/core/src/agent-config/schemas.ts).

## Best practices
- Prefer model selection over regex. Use model-backed selection for ambiguous inputs (see `selectOption()` in [`conversation-session.ts`](../../apps/worker/src/durable-objects/conversation-session.ts)).
- Keep tool behavior deterministic. The model interprets, the tool executes, the narrator explains.
- Keep tool results minimal and user-safe. Avoid exposing internal IDs; follow the narrator prompt constraints.
- If you add a tool, update its schema, guidance, and mock behavior together. See [`tool-definitions.ts`](../../apps/worker/src/models/tool-definitions.ts), [`mock.ts`](../../apps/worker/src/models/mock.ts), and config in [`schemas.ts`](../../packages/core/src/agent-config/schemas.ts).

## Example (tool result → narrator)
```typescript
const replyText = await this.narrateToolResult(
  {
    toolName: "crm.getAvailableSlots",
    result: slots.map((slot) => ({
      date: slot.date,
      timeWindow: slot.timeWindow,
    })),
  },
  {
    input,
    deps,
    streamId,
    fallback: this.formatAvailableSlotsResponse(
      slots,
      "Which one works best?",
    ),
    contextHint: "Offer available times and ask which slot they prefer.",
  },
);
```

## When to revisit
- Changing tool behavior or new tools: update guidance and schemas, then verify prompt constraints still hold.
- Changing model provider or JSON mode behavior: update adapters and re-run tool-call integration tests.

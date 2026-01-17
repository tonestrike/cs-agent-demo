# Multi-Tool Call Architecture

This spec describes how the agent handles multiple tool calls from a single user message.

## Problem

Currently, the agent processes one tool call per user message. When a user says "show me my appointments and my billing", the model must choose one tool. This leads to incomplete responses and requires follow-up turns.

## Solution

Enable the model to request multiple tool calls per message. The agent executes them (potentially in parallel), combines results, and narrates a unified response.

## Design

### Tool Definition with Waiting Hints

Each tool definition includes a `waitingHint` that describes what the agent is doing when calling that tool:

```typescript
type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  waitingHint: string; // e.g., "looking up your appointments"
};

const tools: ToolDefinition[] = [
  {
    name: "crm.listUpcomingAppointments",
    description: "List the customer's upcoming appointments",
    parameters: { customerId: { type: "string" } },
    waitingHint: "looking up your upcoming appointments",
  },
  {
    name: "crm.getOpenInvoices",
    description: "Get the customer's open invoices",
    parameters: { customerId: { type: "string" } },
    waitingHint: "checking your billing",
  },
];
```

### Model Decision Output

The model returns an array of tool calls instead of a single call:

```typescript
type ModelDecision =
  | { type: "final"; text: string }
  | { type: "tool_calls"; calls: ToolCall[]; acknowledgement?: string };

type ToolCall = {
  toolName: string;
  arguments: Record<string, unknown>;
};
```

### Acknowledgement Generation

When multiple tools are called, combine their `waitingHint` values to generate a natural acknowledgement:

```
User: "Show me my appointments and my billing"

Tool calls: [crm.listUpcomingAppointments, crm.getOpenInvoices]

Combined hints: ["looking up your upcoming appointments", "checking your billing"]

Generated acknowledgement: "Sure, I'll look up your upcoming appointments and check your billing."
```

The model generates this acknowledgement using the combined hints as context.

### Execution Flow

```
1. User sends message
2. Model returns { type: "tool_calls", calls: [...] }
3. Collect waitingHints from called tools
4. Generate combined acknowledgement → emit to user
5. Execute tool calls in parallel
6. Collect all results
7. Pass combined results to narrator model
8. Generate unified response → emit to user
```

### Combined Narration

After all tools execute, pass their results to the narrator:

```typescript
const narratorInput = {
  userMessage: "Show me my appointments and my billing",
  toolResults: [
    {
      toolName: "crm.listUpcomingAppointments",
      result: [{ id: "appt_001", date: "2026-01-20", ... }],
    },
    {
      toolName: "crm.getOpenInvoices",
      result: [{ id: "inv_001", amount: 150, ... }],
    },
  ],
  contextHint: "Summarize both the appointments and billing information naturally.",
};
```

## Implementation Steps

1. **Update tool definitions** - Add `waitingHint` to each tool in the tool registry.

2. **Update model adapter** - Change the decision output type to support arrays of tool calls.

3. **Update acknowledgement generation** - Collect hints from all called tools and generate combined acknowledgement.

4. **Parallel tool execution** - Execute all tool calls using `Promise.all()`.

5. **Combined narration** - Pass all results to narrator with a combined context hint.

## Example Flows

### Single Tool (unchanged behavior)

```
User: "What's my next appointment?"
Model: { type: "tool_calls", calls: [{ toolName: "crm.getNextAppointment", ... }] }
Ack: "Let me check your next appointment."
Result: "Your next appointment is Tuesday at 2pm."
```

### Multiple Tools

```
User: "Check my appointments and tell me what I owe"
Model: { type: "tool_calls", calls: [
  { toolName: "crm.listUpcomingAppointments", ... },
  { toolName: "crm.getOpenInvoices", ... }
]}
Ack: "Sure, I'll look up your appointments and check your billing."
[parallel execution]
Result: "You have an appointment on Tuesday at 2pm, and your current balance is $150."
```

## Considerations

- **Error handling**: If one tool fails, still return results from successful tools. Note which failed.
- **Ordering**: Narrator should combine results in a natural order (usually the order requested).
- **Limits**: Cap at 3-4 tool calls per message to avoid overwhelming responses.
- **Streaming**: Emit acknowledgement immediately, then stream the combined response.

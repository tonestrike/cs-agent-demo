# Multi-Tool Call Architecture

This spec describes the conversational agent architecture supporting one-to-many message-to-tool-call relationships.

## Core Principles

### 1. Everything is Conversational

Status updates and final responses are both **assistant messages** in the conversation context. They're not ephemeral events—they're part of the dialogue history the model sees on subsequent turns.

```
Context after acknowledgement:
  User: "Show me my appointments and billing"
  Assistant: "Sure, I'll look up your appointments and check your billing."

Context after response:
  User: "Show me my appointments and billing"
  Assistant: "Sure, I'll look up your appointments and check your billing."
  Assistant: "You have an appointment Tuesday at 2pm. Your balance is $150."
```

This prevents the narrator from repeating what was already said.

### 2. One-to-Many Relationships

A single user message can trigger:
- Zero tool calls (direct conversational response)
- One tool call (current behavior)
- Multiple tool calls (parallel execution with combined response)

The model decides how many tools are needed. The system executes and combines results.

### 3. Acknowledgements Provide Continuity

The acknowledgement serves two purposes:
1. **User-facing**: Immediate feedback that work is happening
2. **Context-facing**: Tells the narrator what was already communicated

## Problems with Current Implementation

1. **Tight coupling**: One message → exactly one tool decision
2. **Lost context**: Status updates aren't in conversation history for narrator
3. **Repetitive responses**: Narrator doesn't know what user was already told
4. **Sequential bottleneck**: Can't handle "check X and Y" naturally

## Solution Design

### Conversation Context Model

All bot utterances—acknowledgements, status updates, and final responses—are added to conversation context:

```typescript
type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  metadata?: {
    type: "acknowledgement" | "status" | "response";
    toolCalls?: string[]; // Tools being invoked
    timestamp: number;
  };
};
```

### Model Decision with Multiple Tools

```typescript
type ModelDecision =
  | { type: "final"; text: string }
  | {
      type: "tool_calls";
      calls: ToolCall[];
      acknowledgement?: string;  // What to tell user now
    };

type ToolCall = {
  toolName: string;
  arguments: Record<string, unknown>;
};
```

### Narrator Context Injection

The narrator receives explicit context about what was already communicated:

```typescript
const narratorInput = {
  userMessage: "Show me my appointments and billing",
  priorAssistantMessage: "Sure, I'll look up your appointments and check your billing.",
  toolResults: [
    { toolName: "crm.listUpcomingAppointments", result: [...] },
    { toolName: "crm.getOpenInvoices", result: [...] },
  ],
  instruction: `
    The user has already been told: "${priorAssistantMessage}"
    Summarize the tool results naturally. Do not repeat the acknowledgement.
    Just provide the information they requested.
  `,
};
```

This is the key insight: **the acknowledgement is in the narrator prompt** so it knows not to repeat "I looked up..." phrasing.

### Execution Flow

```
1. User: "Check my appointments and billing"

2. Decision Model:
   → Decides: tool_calls with [listAppointments, getInvoices]
   → Generates acknowledgement: "Sure, I'll check your appointments and billing."

3. Emit acknowledgement to user (streaming)
   → Add to conversation context as assistant message

4. Execute tools in parallel:
   → listAppointments() → [appt data]
   → getInvoices() → [invoice data]

5. Narrator Model:
   → Receives: user message, prior assistant message, tool results
   → Prompt includes: "User was already told: '...'. Just summarize results."
   → Generates: "You have an appointment Tuesday at 2pm. Your balance is $150."

6. Emit response to user (streaming)
   → Add to conversation context as assistant message
```

### Tool Definition Enhancement

Each tool includes hints for acknowledgement generation:

```typescript
type ToolDefinition = {
  name: string;
  description: string;
  parameters: JSONSchema;
  waitingHint: string;  // "looking up your appointments"
};
```

When multiple tools are called, hints combine naturally:
- `["looking up your appointments", "checking your billing"]`
- → "Sure, I'll look up your appointments and check your billing."

## Benefits

### Fixes Current Issues

1. **Status messages before work**: The acknowledgement is added to context, so narrator knows what was said
2. **No repetitive phrasing**: Narrator prompt explicitly says "don't repeat this"
3. **Parallel execution**: Multiple tools run simultaneously
4. **Natural conversation**: Each utterance builds on prior context

### Enables New Capabilities

1. **Complex requests**: "Cancel my appointment, check my balance, and tell me your hours"
2. **Graceful degradation**: If one tool fails, report partial results
3. **Conversational recovery**: Context preserved for follow-up questions

## Implementation Approach

### Phase 1: Context Preservation
- Add acknowledgements to conversation history
- Pass prior assistant message to narrator prompt
- Verify narrator doesn't repeat acknowledgements

### Phase 2: Multi-Tool Support
- Update model adapter to return array of tool calls
- Implement parallel execution with `Promise.all()`
- Combine results for narrator

### Phase 3: Tool Definition Updates
- Add `waitingHint` to each tool
- Generate combined acknowledgements from hints
- Handle edge cases (empty hints, single tool)

## Example Conversations

### Current (One-to-One)
```
User: "Check my appointments and billing"
Bot: "Let me look up your appointments."
[runs listAppointments]
Bot: "You have an appointment Tuesday."

User: "What about my billing?"
Bot: "Let me check that."
[runs getInvoices]
Bot: "Your balance is $150."
```

### Target (One-to-Many)
```
User: "Check my appointments and billing"
Bot: "Sure, I'll look up your appointments and check your billing."
[runs listAppointments + getInvoices in parallel]
Bot: "You have an appointment Tuesday at 2pm. Your balance is $150."
```

### Complex Request
```
User: "Cancel my Tuesday appointment and tell me what I owe"
Bot: "I'll cancel your Tuesday appointment and check your balance."
[runs cancelAppointment + getInvoices in parallel]
Bot: "Done—I've cancelled your Tuesday appointment. Your current balance is $150."
```

## Considerations

- **Tool dependencies**: Some tools may depend on others' results. Handle sequentially when needed.
- **Error handling**: Partial failures should still return successful results.
- **Context limits**: Cap conversation history to avoid token overflow.
- **Streaming**: Acknowledgement streams first, then tool execution, then response.

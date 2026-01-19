# AI agent architecture (source of truth)

Single, canonical view of the PestCall agent: how requests flow, where state lives, what is validated, and what remains to harden.

## System shape

```mermaid
flowchart LR
    Client["Web UI / RTK client"] -->|HTTP: /api/conversations/:id/message| Worker
    Client -->|WS: /api/conversations/:id/socket| Worker
    Worker -->|proxy| DO["ConversationSession V2 (Durable Object)"]
    DO -->|tools| Repos["Repositories (tickets, calls, customers, appointments)"]
    DO -->|CRM| CRM["CRM adapter (mock/http)"]
    DO -->|logs| D1["D1: call_sessions + call_turns"]
    DO -->|prompt config| Config["agent_prompt_config (D1)"]
```

Core loop: DO receives turn → builds model messages with context → `runWithTools` calls a tool → tool result is narrated/streamed → DO buffers events for resync and persists summaries to D1.

## Generic agent vs. domain configuration

The agent architecture separates generic orchestration from domain-specific logic:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Generic Agent Layer                         │
│  (WebSocket, state coordination, model calls, event streaming)  │
│                                                                 │
│  - No domain concepts (appointments, customers, verification)   │
│  - Stores domainState as opaque Record<string, unknown>        │
│  - Calls tools without knowing what they do                    │
│  - Emits events without understanding their meaning            │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Providers inject behavior
                              │
┌─────────────────────────────────────────────────────────────────┐
│                   Configuration Layer                           │
│    (Tool definitions, prompt templates, domain logic)           │
│                                                                 │
│  - ToolProvider: defines tools, gating rules, acknowledgements │
│  - PromptProvider: builds prompts based on domain state        │
│  - All business logic (appointments, workflows) lives here     │
└─────────────────────────────────────────────────────────────────┘
```

**Constraint**: The agent layer must never contain domain-specific types or logic. If you find yourself adding properties like `hasAppointments` or `isVerified` to the agent's types, that logic belongs in the configuration layer instead.

### How this works in practice

| Concern | Generic Agent | Configuration Layer |
|---------|---------------|---------------------|
| State storage | `domainState: Record<string, unknown>` | Knows structure: `conversation.appointments`, `verification.verified` |
| Tool gating | Calls `toolProvider.getTools(state)` | Checks `domainState["conversation"]?.verification?.verified` |
| Acknowledgements | Calls `ack(sessionState)` if function | Function inspects `domainState` to decide if cached |
| Prompts | Calls `promptProvider.buildSystemPrompt(state)` | Reads domain state to build context-aware prompts |

### Key files

- **Generic agent**: [`v2/session.ts`](../apps/worker/src/durable-objects/conversation-session/v2/session.ts), [`v2/types.ts`](../apps/worker/src/durable-objects/conversation-session/v2/types.ts)
- **Configuration**: [`models/tool-definitions.ts`](../apps/worker/src/models/tool-definitions.ts), [`v2/providers/tool-provider.ts`](../apps/worker/src/durable-objects/conversation-session/v2/providers/tool-provider.ts), [`v2/providers/prompt-provider.ts`](../apps/worker/src/durable-objects/conversation-session/v2/providers/prompt-provider.ts)

### Example: conditional acknowledgements

Acknowledgements may be skipped when data is already cached. This logic belongs entirely in the configuration layer:

```typescript
// tool-definitions.ts (CONFIGURATION - has domain knowledge)
"crm.getAppointmentById": {
  acknowledgement: (domainState) => {
    // Domain-specific: knows about conversation.appointments
    const conversation = domainState["conversation"] as
      | { appointments?: unknown[] }
      | undefined;
    const hasAppointments = Boolean(conversation?.appointments?.length);
    return hasAppointments ? null : "Checking that appointment now.";
  },
}

// session.ts (AGENT - generic, no domain knowledge)
if (tool.definition.acknowledgement) {
  const ack = tool.definition.acknowledgement;
  // Just calls the function - doesn't know what it checks
  const ackText = typeof ack === "function" ? ack(sessionState) : ack;
  if (ackText) {
    turn.acknowledgementPrompts.push(ackText);
  }
}
```

## Transport and endpoints

- Conversation API (v2): `/api/v2/conversations/:id/{socket|message|resync|debug|rtk-token|summary}` proxied to the DO in [`apps/worker/src/index.ts`](../apps/worker/src/index.ts).
- WebSocket stream events: `token`, `status`, `final`, `error`, `resync`, `speaking`.
- Resync: POST `/resync` with `lastEventId` replays buffered events plus state snapshot.
- RealtimeKit: `/rtk-token` issues participant tokens; meeting/config pulled from env (see [`realtime-kit.ts`](../apps/worker/src/realtime-kit.ts)).

## Durable Object responsibilities

- Owns session state (verification, customer id, workflow ids, cached options/slots, greeting flags, event buffer, turn metrics).
- Routes messages to `runWithTools` with tool definitions from [`tool-definitions.ts`](../apps/worker/src/models/tool-definitions.ts) and handlers from [`tool-flow/registry.ts`](../apps/worker/src/durable-objects/conversation-session/tool-flow/registry.ts).
- Applies gating: verification (`conversation.verification.verified`) and workflow activity (`rescheduleWorkflowId`, `cancelWorkflowId`, `activeSelection`, `availableSlots`).
- Streams narrator tokens and aggregates tool acknowledgements into status events.
- Persists summaries to D1 via repositories; long-term context comes from [`calls.ts`](../apps/worker/src/repositories/calls.ts).

Session modules (v2):
- Coordinator/routes: [`v2/session.ts`](../apps/worker/src/durable-objects/conversation-session/v2/session.ts)
- State manager: [`v2/state.ts`](../apps/worker/src/durable-objects/conversation-session/v2/state.ts)
- Event emitter/buffer: [`v2/events.ts`](../apps/worker/src/durable-objects/conversation-session/v2/events.ts)
- Connections: [`v2/connection.ts`](../apps/worker/src/durable-objects/conversation-session/v2/connection.ts)
- Providers: [`v2/providers/tool-provider.ts`](../apps/worker/src/durable-objects/conversation-session/v2/providers/tool-provider.ts), [`v2/providers/prompt-provider.ts`](../apps/worker/src/durable-objects/conversation-session/v2/providers/prompt-provider.ts)

## Prompts and model selection

- Prompt config lives in D1 `agent_prompt_config`; migrations [`20250201200000_agent_prompt_config.sql`](../apps/worker/migrations/20250201200000_agent_prompt_config.sql) and [`20250201203000_agent_prompt_config_additions.sql`](../apps/worker/migrations/20250201203000_agent_prompt_config_additions.sql).
- Repository and RPC: [`repositories/agent-config.ts`](../apps/worker/src/repositories/agent-config.ts), [`routes/agent-config.ts`](../apps/worker/src/routes/agent-config.ts).
- UI editor: [`apps/web/src/app/agent/page.tsx`](../apps/web/src/app/agent/page.tsx).
- Fields: `personaSummary`, `scopeMessage`, `toolGuidance.*`, `modelId`, `tone`.
- Prompt provider builds greeting + system prompt per config; model id read from config/env.

## Tools and workflows

- Tools defined in [`models/tool-definitions.ts`](../apps/worker/src/models/tool-definitions.ts) with Zod schemas and acknowledgements.
- Handlers in [`tool-flow/registry.ts`](../apps/worker/src/durable-objects/conversation-session/tool-flow/registry.ts) call repositories and CRM adapters.
- Workflows (cancel/reschedule) use two-step commits (select → confirm) and slot fetching before reschedule confirm. Workflow constants in [`workflows/constants.ts`](../apps/worker/src/workflows/constants.ts).

## Streaming and resync behavior

- Greeting sent on WebSocket connect once per call session (tracked in domainState).
- Tokens emitted via `emitToken()` as SSE is parsed; `final` includes the narrated message and tool outputs.
- Event buffer retained for resync and sent alongside the latest domain state.
- Barge-in: `barge_in` message or new message during `speaking` cancels current stream (`canceledStreamIds`).

## Debugging and observability

- Snapshot: `GET /api/conversations/:id/debug` (state, eventBuffer, turnDecision, turnMetrics, persisted session/turns).
- Summary: `GET /api/conversations/:id/summary`.
- Logs: `bun run scripts/logs-call-session.ts <callSessionId>` filters worker logs.
- D1 inspection: `call_sessions`, `call_turns`, `customers_cache` (see repository code for shape).

## Testing

- Integration/e2e live under `apps/worker/src/conversation-session.*.e2e.test.ts` and `conversation-session.websocket.e2e.test.ts` to cover streaming, verification, cancellation, reschedule, and tool correctness.
- Router integration tests (`apps/worker/src/router.integration.test.ts`) validate RPC flows (tickets, CRM, workflows).

## Outstanding tests

- Validate multi-tool chains with `maxRecursiveToolRuns > 1`.
- End-to-end cancel/reschedule completion through v2 (tool calls + narrator outputs).
- Voice/RealtimeKit flow end-to-end with token refresh and speaking states.

## Future improvements

- Re-enter intent/workflow selection automatically after verification within the DO (no standalone verification reply).
- Add off-domain handling with human-offer escalation for repeated unclear turns.
- Improve DO logging ergonomics (per-turn completion logs, simpler filtering by session id).
- Implement real appointment CRUD in D1: create/reschedule/cancel appointments and list upcoming appointments from DB.

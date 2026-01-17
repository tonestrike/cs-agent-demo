# Tool calling: what we send, what we expect, why it fails

We’ve seen the agent emit a fallback (“I could not interpret…”) even when the user intent is clear (e.g., “I want to reschedule”). This page explains the pipeline, the model inputs, the tools we expose, and the failure modes we’re hitting.

## Roles and models
- **Narrator/status model**: Only returns text (acknowledgements, phrasing of tool results). Never returns tool calls.
- **Tool model** (`model.generate` in `handleToolCallingFlow`): Decides the next tool or a final response. This is where tool calls should be produced.

## What we send to the tool model
- System instructions: `buildDecisionInstructions` (persona, policies, and “Call tools when needed; otherwise respond with plain text.”).
- Tools: full `toolDefinitions` rendered as JSON schemas (see `openRouterTools` / `workersAiTools`).
- Messages: recent turns from `getRecentMessages`:
  - Customer messages → `role: user`
  - Agent messages and status messages → `role: assistant`
- Context: `buildModelContext()` (verification state, cached appointments/slots).

Adapters:
- OpenRouter: `tools`, `tool_choice: "auto"`, messages built with instructions + history. See [`models/openrouter.ts`](../../apps/worker/src/models/openrouter.ts).
- Workers AI: `tools`, messages built similarly. See [`models/workers-ai.ts`](../../apps/worker/src/models/workers-ai.ts). Both return `final` with fallback text if parsing fails or text is empty.

## What should happen
- After verification: the tool model should select a tool for clear intents (reschedule/cancel/schedule/billing/etc.) or produce a meaningful `final`.
- When tools are selected: DO runs them, narrates the result, records the turn.

## What has been failing
- The tool model sometimes returns `final` with empty/invalid text (adapter injects the fallback) even when intent is obvious.
- Because status/narrator lines are part of history, the model can think it “already answered” and choose `final`.
- Empty/invalid tool-call JSON also lands in the adapter fallback.

## Current mitigations in code
- Post-verification bare ZIP guard: if the user sends only a ZIP/empty right after verification, we bypass the tool model and prompt for next action.
- Intent guard: if the tool model returns `final` but the text clearly contains reschedule/cancel/schedule keywords, we ignore that `final` and route through the deterministic pending-intent handler instead of emitting the fallback. See [`conversation-session.ts`](../../apps/worker/src/durable-objects/conversation-session.ts) in `handleToolCallingFlow` and `detectActionIntent`.
- Turn metadata stored in D1 includes `modelMessages` and `modelContext` so you can inspect exactly what the model saw.

## Still risky / gaps
- The tool model is still allowed to return `final` with no tools in other high-intent cases (billing, payments, policy) if we don't force a tool plan.
- ~~No raw model output logged when we hit adapter fallback (only the injected fallback text).~~ **Fixed**: Diagnostic fallback now embeds full context (see below).
- Status lines can bias the tool model toward `final`.

## How to inspect a bad turn

### Diagnostic fallback (inline debugging)

When the tool model returns an empty final or invalid decision, the agent now embeds diagnostic context directly in the fallback message. The response text looks like:

```
I could not interpret the request. Can you rephrase? I can also connect you with a person.

---DEBUG---
{
  "reason": "empty_final_text",
  "userMessage": "I want to reschedule",
  "messageHistory": [
    { "role": "user", "content": "hi" },
    { "role": "assistant", "content": "Hello! How can I help?" },
    { "role": "user", "content": "I want to reschedule" }
  ],
  "context": "Customer verified. Verification state: {...}",
  "provider": "openrouter",
  "modelId": "anthropic/claude-sonnet",
  "rawDecisionType": "final",
  "rawText": null
}
---/DEBUG---
```

**Fields in the debug block:**
- `reason`: Why we fell back (`empty_final_text`, `invalid_tool_decision`, `adapter_parse_error`, `unknown`)
- `userMessage`: The user's message that triggered the fallback
- `messageHistory`: Last 5 messages (truncated to 100 chars each)
- `context`: Model context string (truncated to 500 chars)
- `provider`: Which adapter (`openrouter`, `workers-ai`)
- `modelId`: Specific model used
- `rawDecisionType`: What the model returned (`final`, `tool_calls`, etc.)
- `rawText`: Raw text from model (truncated to 200 chars)

**Parsing the debug block:**
```ts
import { extractDiagnosticsFromFallback } from "./conversation-session/fallback";

const diagnostics = extractDiagnosticsFromFallback(agentResponse);
if (diagnostics) {
  console.log("Fallback reason:", diagnostics.reason);
  console.log("User said:", diagnostics.userMessage);
}
```

See [`conversation-session/fallback.ts`](../../apps/worker/src/durable-objects/conversation-session/fallback.ts) for the implementation.

### AI-powered debug analysis

For richer analysis, you can pass the diagnostics to an AI model that generates actionable insights:

```ts
import {
  extractDiagnosticsFromFallback,
  buildAIDebugPrompt,
  parseAIDebugResponse,
  formatAIDebugResult,
} from "./conversation-session/fallback";

// Extract diagnostics from fallback message
const diagnostics = extractDiagnosticsFromFallback(agentResponse);
if (!diagnostics) return;

// Build prompt for AI analysis
const prompt = buildAIDebugPrompt(diagnostics);

// Call your AI model (example with OpenRouter)
const aiResponse = await model.generate({ messages: [{ role: "user", content: prompt }] });

// Parse and format the result
const analysis = parseAIDebugResponse(aiResponse.text);
console.log(formatAIDebugResult(analysis));
```

**Output example:**
```
🔴 Model returned empty final despite clear "reschedule" intent

📍 Root cause: The model received the user's reschedule request but returned
   an empty final instead of calling the listAppointments tool.

⚠️  Issues:
   • Clear reschedule intent detected but model chose final instead of tool
   • Model may be confused by status messages in history

💡 Suggestions:
   → Check if reschedule tools are available in tool definitions
   → Strengthen prompting to require tool calls for high-intent messages
   → Review if status messages are polluting the conversation history
```

The AI analyzer is more intelligent than the rule-based fallback - it can:
- Understand nuanced intent beyond keyword matching
- Identify patterns in conversation history
- Suggest specific, contextual fixes
- Assess severity based on business impact

### Traditional inspection methods

1) Query D1 turns:
   ```
   bunx wrangler d1 execute pestcall_local --remote --config apps/worker/wrangler.toml \
     --command "SELECT speaker, ts, text, meta_json FROM call_turns WHERE call_session_id = '<callSessionId>' ORDER BY ts;"
   ```
   Check `meta_json` on agent turns for `modelMessages`, `modelContext`, `decision`, `toolCalls`.
2) Pull DO debug snapshot:
   ```
   curl -H "x-demo-auth: $DEMO_TOKEN" "$WORKER_BASE/api/conversations/<callSessionId>/debug"
   ```
   Look at `turnDecision`, `turnMetrics`, `eventBuffer`.
3) Tail logs for the session for adapter warnings:
   - `conversation.session.final.empty_text`
   - `conversation.session.tool_call.invalid_decision`
   - `openrouter.tool_call.*` / `workers_ai.tool_call.*`

## Possible fixes (next steps)
- Enforce tool path for high-intent domains: if verified and intent is reschedule/cancel/schedule/billing/payment, reject `final` with no tools; run a deterministic tool plan or force a tool call. (Partial guard in code for reschedule/cancel/schedule; extend to others.)
- Trim intra-turn statuses from the tool-model history to avoid "already answered" bias. (Implemented: status/system turns are excluded from `getRecentMessages` for the tool model.)
- ~~Log raw adapter output when we fall back (store in `debug` with reason and a truncated raw snippet).~~ **Done**: Diagnostic fallback embeds full context including raw model output.
- Add a minimal action-plan state machine so we don't depend on the model to pick the obvious first tool (e.g., always list appointments before reschedule flow).

## Message flow (simplified)
1) Message arrives at `/api/conversations/{id}/message` → DO `runMessage` in [`conversation-session.ts`](../../apps/worker/src/durable-objects/conversation-session.ts).
2) Verification gate: [`handleVerificationGate`](../../apps/worker/src/durable-objects/conversation-session.ts) asks for ZIP or verifies and continues (no standalone verification reply).
3) Pending workflows: cancel/reschedule selections handled first in `handleWorkflowSelection`.
4) Tool-calling phase: [`handleToolCallingFlow`](../../apps/worker/src/durable-objects/conversation-session.ts):
   - Build `messages` (customer/agent only; status/system filtered out), `context` (verification + cached items).
   - Call tool model `generate` (adapters: [`models/openrouter.ts`](../../apps/worker/src/models/openrouter.ts), [`models/workers-ai.ts`](../../apps/worker/src/models/workers-ai.ts)).
   - If tool calls returned: emit acknowledgement immediately, run tools, narrate results.
   - If `final` with no tools:
     - If intent is actionable (reschedule/cancel/schedule, etc.), bypass the empty final and run deterministic intent handling.
     - Otherwise emit the final (fallback if empty).
5) Narration/streaming: narrator model (text-only) phrases tool results (`narrate*` helpers in [`conversation-session.ts`](../../apps/worker/src/durable-objects/conversation-session.ts)).
6) Persist: turns and metadata (including `modelMessages`/`modelContext`) are stored in D1 via `recordTurns`; DO event buffer updated; `/debug` reflects state.

## Architecture issues (why fallbacks keep happening)

The current architecture has **multiple interception points** that prevent the model from seeing the full context. Each intercept makes partial decisions with incomplete information.

### Current flow (fragmented)

```
Message arrives
    ↓
PHASE 4: Verification Gate (deterministic)
    → Intercepts: ZIP codes, unverified users
    → Problem: Model never sees user intent (e.g., "I want to reschedule")
    → Result: Generic "what's your ZIP?" instead of "Happy to help reschedule! What's your ZIP?"
    ↓
PHASE 5: handleWorkflowSelection (partial model via selectOption)
    → Intercepts: appointment/slot/confirmation selections
    → Problem: Uses simple selectOption() with LIMITED context
    → Result: Main tool model never sees these messages
    ↓
PHASE 6: Tool Calling Flow
    ├── detectActionIntent PRE-MODEL (regex)
    │   → Intercepts: "reschedule", "cancel", "schedule" keywords
    │   → Problem: Regex-based, no nuance
    │
    ├── model.generate() ← FINALLY the model sees something
    │   → Problem: Only returns ONE decision, no loop
    │   → Problem: Workers AI adapter only takes toolCalls[0], ignores rest
    │
    └── detectActionIntent POST-MODEL (regex override)
        → If model returns final but text has keywords, override it
        → Problem: More regex hacks layered on top
```

### Adapter issues

**Workers AI adapter** ([`workers-ai.ts`](../../apps/worker/src/models/workers-ai.ts)):
```typescript
const toolCall = toolCalls[0];  // Only first tool, ignores rest!
if (toolCall?.name) {
  return validated.data;        // Returns immediately, no loop
}
```

**OpenRouter adapter** ([`openrouter.ts`](../../apps/worker/src/models/openrouter.ts)):
- Slightly better: handles multiple tool calls with `tool_calls` type
- Still no loop: returns tool calls, expects external code to execute and... then what?

**Neither adapter implements a tool result → model loop.** The pattern is:
```
model.generate() → returns tool call
   ↓
(external code executes tool)
   ↓
model.respond(result) → narrates result as final  ← SEPARATE METHOD, NOT A LOOP
```

### Missing capabilities

**Workers AI supports but we don't use:**
- `temperature`, `top_p`, `frequency_penalty`, `presence_penalty` - generation parameters
- `stream: true` - streaming responses
- `@cloudflare/ai-utils` with `runWithTools` - **embedded function calling with automatic tool loop**

See [Cloudflare Workers AI docs](https://developers.cloudflare.com/workers-ai/) and [ai-utils on GitHub](https://github.com/cloudflare/ai-utils).

---

## Direction: Model-first architecture

The fix is architectural: **let the model see everything and decide everything**.

### Target flow (unified)

```
Message arrives
    ↓
Build FULL context (no interception):
    - Verification state: { verified: false, customerId: null }
    - Workflow state: { cancelWorkflowId: "...", step: "awaiting_confirmation" }
    - Available options: [appointments], [slots], pending confirmation
    - Full conversation history
    ↓
Filter tools based on state:
    - Not verified? Only show: verifyZip, getServicePolicy
    - Verified? Show all CRM tools
    - Active workflow? Show workflow tools: selectAppointment, selectSlot, confirm
    ↓
runWithTools() with tool loop:
    - Model calls tool(s)
    - Tools execute, results feed back to model
    - Model decides: call more tools OR return final response
    - Loop continues until model produces final text
    ↓
Emit final response (single exit point)
```

### Tool gating

Add metadata to tool definitions for declarative gating:

```typescript
// In tool-definitions.ts
type ToolDefinition = {
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  missingArgsMessage: string;
  // NEW:
  requiresVerification?: boolean;
  requiresActiveWorkflow?: boolean;
};

export const toolDefinitions = {
  // Always available
  "identity.verifyZip": {
    requiresVerification: false,
    // ...
  },
  "crm.getServicePolicy": {
    requiresVerification: false,  // Anyone can ask about policies
    // ...
  },

  // Require verification
  "crm.listUpcomingAppointments": {
    requiresVerification: true,
    // ...
  },
  "crm.cancelAppointment": {
    requiresVerification: true,
    // ...
  },

  // Require active workflow
  "workflow.selectAppointment": {
    requiresVerification: true,
    requiresActiveWorkflow: true,
    // ...
  },
  "workflow.selectSlot": {
    requiresVerification: true,
    requiresActiveWorkflow: true,
    // ...
  },
  "workflow.confirm": {
    requiresVerification: true,
    requiresActiveWorkflow: true,
    // ...
  },
};
```

Filter at runtime:
```typescript
function getAvailableTools(state: SessionState): ToolDefinition[] {
  const verified = state.conversation?.verification.verified ?? false;
  const hasWorkflow = Boolean(state.cancelWorkflowId || state.rescheduleWorkflowId);

  return Object.entries(toolDefinitions)
    .filter(([_, def]) => {
      if (def.requiresVerification && !verified) return false;
      if (def.requiresActiveWorkflow && !hasWorkflow) return false;
      return true;
    })
    .map(([name, def]) => ({ name, ...def }));
}
```

### Using `runWithTools` from `@cloudflare/ai-utils`

This package implements the tool loop we need:

```typescript
import { runWithTools } from "@cloudflare/ai-utils";

const response = await runWithTools(
  env.AI,
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  {
    messages: [...conversationHistory],
    tools: getAvailableTools(sessionState).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      function: async (args) => executeToolHandler(tool.name, args, ctx),
    })),
  },
  {
    maxRecursiveToolRuns: 5,      // Allow multi-step chains: verify → list → select → confirm
    streamFinalResponse: true,    // Stream the final text response
    strictValidation: true,       // Throw on invalid tool args
    trimFunction: autoTrimTools,  // Reduce tokens by filtering irrelevant tools
  }
);
// response is the FINAL text after all tool chains complete
```

**Key options:**
| Option | Purpose |
|--------|---------|
| `maxRecursiveToolRuns` | How many tool calls can chain (default: 1) |
| `streamFinalResponse` | Return `ReadableStream` for real-time streaming |
| `autoTrimTools` | Filter tools by relevance before sending to model |
| `strictValidation` | Throw errors on schema mismatches |
| `verbose` | Detailed logging for debugging |

### Example conversation with new architecture

```
1. User (unverified): "I want to reschedule"
2. Model sees:
   - tools = [verifyZip, getServicePolicy]  ← protected tools hidden
   - context = "User is NOT verified"
3. Model responds: "Happy to help you reschedule! What's your ZIP code?"

4. User: "90210"
5. Model calls: verifyZip({ zip: "90210" })
6. Tool returns: { verified: true, customerId: "cust_123" }
7. Model now has access to more tools
8. Model calls: listAppointments({ customerId: "cust_123" })
9. Tool returns: [{ id: "apt_1", date: "Tuesday" }, ...]
10. Model responds: "I see you have an appointment Tuesday. Want to reschedule that one?"

11. User: "yes"
12. Model calls: workflow.selectAppointment({ appointmentId: "apt_1" })
13. ... continues through the flow
```

All in one natural conversation, no phases, no regex, no interception.

---

## Implementation roadmap

### Phase 1: Foundation ✅
- [x] Add `@cloudflare/ai-utils` as dependency
- [x] Add gating metadata to [`tool-definitions.ts`](../../apps/worker/src/models/tool-definitions.ts)
  - `requiresVerification`, `requiresActiveWorkflow` flags
- [x] Create `getAvailableTools(state)` and `getAvailableToolNames(state)` functions

### Phase 2: Tool loop
- [ ] Create unified `runAgentLoop()` using `runWithTools`
- [ ] Define tool handlers that execute CRM/workflow functions and return results
- [x] Add generation parameters: `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`
  - See `GenerationParams` type in [`workers-ai.ts`](../../apps/worker/src/models/workers-ai.ts)
- [ ] Support streaming with `streamFinalResponse: true`

### Phase 3: Workflow tools ✅
- [x] Add `workflow.selectAppointment` tool
- [x] Add `workflow.selectSlot` tool
- [x] Add `workflow.confirm` tool
- [ ] Include workflow state in model context

### Phase 4: Remove interception
- [ ] Remove `handleWorkflowSelection` interception (make it a fallback only)
- [ ] Remove `detectActionIntent` pre-model guard
- [ ] Remove `detectActionIntent` post-model override
- [ ] Consolidate response finalization to single exit point

### Phase 5: Cleanup
- [ ] Remove duplicate boilerplate (emit/update/sync/record pattern)
- [ ] Delete legacy `handleAgentMessage` path
- [ ] Update tests for new architecture

---

## Legacy direction (for reference)

The following was the previous direction before the model-first refactor was planned:

- One model for tool decisions: rely on the tool model (OpenRouter or Workers AI) to infer intent and choose tools; no deterministic regex intent detection in the steady state.
- Richer, clearer prompts: strengthen tool prompts to require tool calls (with acknowledgements) in high-intent contexts, and to emit meaningful finals when truly no tool is needed.
- Remove deterministic guards: phase out stopgaps like `detectActionIntent` once the model reliably picks tools; use them only as temporary safety nets.
- Better visibility: log raw adapter output on empty/invalid finals and include decision snapshots in turn metadata so failures are debuggable.
- Deterministic fallbacks only for safety: if the model fails repeatedly in an actionable state, default to a minimal deterministic plan (e.g., list appointments for reschedule) rather than emitting "interpret" fallbacks.

## Conversation session refactor (deep dive)
The DO is being refactored from monolithic to modular. Target shape:
- **Coordinator** (`conversation-session.ts`): routing, socket/message entrypoints, state init, event emission wiring.
- **Verification module**: ZIP gate, pending intent capture, identity summary updates.
- **Tool flow module**: model calls + decision handling (single/multi tool calls, acknowledgements, finals), context/messages assembly.
- **Workflows module**: cancel/reschedule orchestration (start/select/confirm), slot/appointment selection helpers.
- **Messaging/state module**: recent message collection, turn persistence, event buffer/resync helpers.
- **Shared helpers**: intent parsing (temporary), model context, narration wrappers.

### Progress

**Completed:**
- ✅ Workflows module extracted to [`conversation-session/workflows/`](../../apps/worker/src/durable-objects/conversation-session/workflows/)
  - Uses `WorkflowContext` interface for dependency injection
  - Handlers: `appointment-cancel.ts`, `appointment-reschedule.ts`, `appointment-selection.ts`
  - Helpers: `appointment-helpers.ts` for shared logic
  - Model-driven selection (no regex parsing)
- ✅ Tool flow module extracted to [`conversation-session/tool-flow/`](../../apps/worker/src/durable-objects/conversation-session/tool-flow/)
  - Uses `ToolFlowContext` interface with explicit context objects
  - Handlers return raw results (`ToolRawResult`), not narrated text
  - Aggregation layer merges results for single narration step
  - Uses Zod schemas from `tool-definitions.ts` for arg validation
  - Registry pattern for tool dispatch

- ✅ Messaging module extracted to [`conversation-session/messages/`](../../apps/worker/src/durable-objects/conversation-session/messages/)
  - `ensureCallSession`, `recordTurns`, `getRecentMessages`, `recordStatusTurn`
  - `updateIdentitySummary`, `updateAppointmentSummary`
  - Uses `MessagesContext` interface with logger and calls repository
  - Pure functions with explicit dependencies (no `this` binding)

**Integrated:**
- ✅ Messages module integrated into coordinator (methods delegate to extracted functions)
- ✅ Workflows selection integrated via `handleWorkflowSelectionFn`

**Remaining:**
- 🔲 Wire tool-flow for complex tools (cancel/reschedule/create appointment handlers)
- 🔲 Delete remaining duplicate code after full tool-flow integration

### Key patterns

**Type-safe tool args:** Handlers use typed args inferred from Zod schemas:
```ts
// Handler receives validated, typed args
export async function handleGetServicePolicy(
  ctx: ToolFlowContext,
  { args }: ToolExecutionInput<"crm.getServicePolicy">,
): Promise<ToolRawResult> {
  const policyText = await getServicePolicy(ctx.deps.crm, args.topic);
  // ...
}
```

**Aggregate tool results:** Multiple tools execute in parallel, results are merged, single narration step handles all:
```ts
const result = await executeAndNarrate(ctx, toolCalls, input);
// result.replyText is narrated from ALL tool results together
```

Risks/mitigations:
- **this-binding/state drift**: use explicit context objects instead of method calls to avoid losing `this`.
- **Shared storage updates**: centralize state writes in coordinator or a small state service to avoid double-writes.
- **Tests**: run `bun typecheck`, `bun lint`, and e2e suites (`conversation-session.*.e2e.test.ts`) after each extraction step.

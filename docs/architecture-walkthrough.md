# PestCall Architecture Walkthrough

> Follow a customer conversation from click to response, then see how we evaluate it.

---

## Part 1: The Conversation Flow

Let's trace what happens when a customer says "Hi, I need to cancel my appointment."

### Step 1: User Clicks "Start Call"

The React app calls the [useConversationSession](../apps/web/src/app/customer/hooks/use-conversation-session.ts) hook:

```typescript
// use-conversation-session.ts:538-577

const startCall = useCallback(async () => {
  const sessionId = crypto.randomUUID();  // New conversation ID
  setCallSessionId(sessionId);
  await ensureSocket(sessionId);          // Open WebSocket
}, [...]);
```

This opens a WebSocket to the worker:
```
wss://pestcall-worker.../api/conversations/{sessionId}/socket
```

**Related code:**
- [startCall function (line 538)](../apps/web/src/app/customer/hooks/use-conversation-session.ts)
- [ensureSocket function (line 151)](../apps/web/src/app/customer/hooks/use-conversation-session.ts) - WebSocket connection logic
- [buildWsUrl function (line 138)](../apps/web/src/app/customer/hooks/use-conversation-session.ts) - URL construction

---

### Step 2: WebSocket Connects to Durable Object

The worker routes the connection to a Durable Object - a stateful instance that lives for this conversation:

```typescript
// index.ts:166-214 (simplified)

if (url.pathname.match(/\/api\/conversations\/([^/]+)\/socket/)) {
  const conversationId = match[1];

  // Get or create Durable Object for this conversation
  const id = env.CONVERSATION_SESSION_V2.idFromName(conversationId);
  const stub = env.CONVERSATION_SESSION_V2.get(id);

  return stub.fetch(request);  // Hand off to DO
}
```

The Durable Object ([ConversationSessionV2](../apps/worker/src/durable-objects/conversation-session/v2/session.ts)) handles the WebSocket upgrade and is now ready to receive messages.

**Related code:**
- [Worker entry point - index.ts](../apps/worker/src/index.ts) - All request routing
- [Conversation route matching (line 167)](../apps/worker/src/index.ts)
- [DO class export (line 13)](../apps/worker/src/index.ts)

---

### Step 3: User Sends a Message

When the user types "Hi, I need to cancel my appointment", the web app sends it via HTTP:

```typescript
// use-conversation-session.ts:447-533

const sendMessage = useCallback(async (message: string) => {
  // POST to the conversation endpoint
  await fetch(`/api/conversations/${sessionId}/message`, {
    method: "POST",
    body: JSON.stringify({ phoneNumber, text: message }),
  });
}, [...]);
```

**Related code:**
- [sendMessage function (line 447)](../apps/web/src/app/customer/hooks/use-conversation-session.ts)
- [WebSocket message handler (line 187)](../apps/web/src/app/customer/hooks/use-conversation-session.ts) - Receives streamed responses

---

### Step 4: Durable Object Processes the Message

The DO receives the message and runs the agent loop:

```typescript
// session.ts (simplified)

async handleMessage(input: { text: string, phoneNumber: string }) {
  // 1. Detect intent (cancel, reschedule, etc.)
  const intent = detectActionIntent(input.text);
  // → { kind: "cancel" }

  // 2. Build the prompt with conversation history and available tools
  const systemPrompt = this.promptProvider.buildPrompt(this.state);

  // 3. Get available tools based on current state
  const tools = this.toolProvider.getTools(this.state);
  // → Before verification: only verifyAccount, getServicePolicy

  // 4. Call Workers AI
  const response = await this.ai.run("@hf/nousresearch/hermes-2-pro-mistral-7b", {
    messages: [...history, { role: "user", content: input.text }],
    tools: tools,
  });

  // 5. Stream response tokens to client via WebSocket
  this.events.emit({ type: "token", text: "I can help" });
  this.events.emit({ type: "token", text: " with that." });
}
```

**Related code:**
- [Session class - session.ts line 76](../apps/worker/src/durable-objects/conversation-session/v2/session.ts) - Main coordinator
- [HTTP message handler (line 198)](../apps/worker/src/durable-objects/conversation-session/v2/session.ts)
- [Intent detection - intent.ts](../apps/worker/src/durable-objects/conversation-session/intent.ts) - Detects cancel/reschedule/etc
- [Prompt provider - prompt-provider.ts](../apps/worker/src/durable-objects/conversation-session/v2/providers/prompt-provider.ts) - Builds system prompt
- [Event emitter - events.ts](../apps/worker/src/durable-objects/conversation-session/v2/events.ts) - Streams to WebSocket

---

### Step 5: AI Decides to Call a Tool

The AI sees the user wants to cancel but isn't verified yet. It responds asking for ZIP code. Later, when the user provides "98109":

```typescript
// AI response includes a tool call:
{
  tool_calls: [{
    function: {
      name: "crm.verifyAccount",
      arguments: { zipCode: "98109" }
    }
  }]
}
```

**Related code:**
- [Tool definitions - tool-definitions.ts line 62](../apps/worker/src/models/tool-definitions.ts) - All available tools
- [crm.verifyAccount definition (line 96)](../apps/worker/src/models/tool-definitions.ts)

---

### Step 6: Tool Handler Executes

The session looks up the handler and runs it:

```typescript
// registry.ts:26-37

export const toolHandlerRegistry = {
  "crm.verifyAccount": handleVerifyAccount,
  "crm.cancelAppointment": handleCancelAppointment,
  // ...
};
```

The verify handler:

```typescript
// verify-account.ts:30-77 (simplified)

export async function handleVerifyAccount(ctx, { args }) {
  const phoneNumber = ctx.sessionState.lastPhoneNumber;

  // Look up customer by phone
  const customers = await lookupCustomerByPhone(ctx.deps.crm, phoneNumber);

  // Try to verify with ZIP
  for (const customer of customers) {
    const verified = await verifyAccount(ctx.deps.crm, customer.id, args.zipCode);

    if (verified) {
      return {
        result: { verified: true, customerId: customer.id },
        stateUpdates: {
          conversation: {
            status: "VerifiedIdle",
            verification: { verified: true, customerId: customer.id },
          },
        },
      };
    }
  }

  return { result: { verified: false, error: "zip_mismatch" } };
}
```

**Related code:**
- [Tool handler registry - registry.ts](../apps/worker/src/durable-objects/conversation-session/tool-flow/registry.ts)
- [Verify account handler - verify-account.ts](../apps/worker/src/durable-objects/conversation-session/tool-flow/handlers/verify-account.ts)
- [Cancel appointment handler - cancel-appointment.ts](../apps/worker/src/durable-objects/conversation-session/tool-flow/handlers/cancel-appointment.ts)
- [List appointments handler - list-appointments.ts](../apps/worker/src/durable-objects/conversation-session/tool-flow/handlers/list-appointments.ts)
- [Get available slots handler - get-available-slots.ts](../apps/worker/src/durable-objects/conversation-session/tool-flow/handlers/get-available-slots.ts)

---

### Step 7: State Updates, More Tools Become Available

After verification, the [tool gating](../apps/worker/src/models/tool-definitions.ts) changes:

```typescript
// tool-definitions.ts:234-245

"crm.cancelAppointment": {
  description: "Cancel a scheduled appointment.",
  requiresVerification: true,  // Now available!
  // ...
}
```

The [getAvailableTools](../apps/worker/src/models/tool-definitions.ts) function filters based on state (line 398):

```typescript
// tool-definitions.ts:398-424

export const getAvailableTools = (state: ToolGatingState) => {
  // Check verification requirement
  if (definition.requiresVerification && !state.isVerified) {
    continue;  // Skip this tool
  }
  // ...
};
```

Now when the user confirms "Yes, please cancel it", the AI can call `crm.cancelAppointment`.

**Related code:**
- [Tool gating logic (line 398)](../apps/worker/src/models/tool-definitions.ts)
- [ToolGatingState type (line 41)](../apps/worker/src/models/tool-definitions.ts)

---

### Step 8: Response Streams Back

Throughout this process, events stream to the client via WebSocket:

```
→ { type: "status", text: "Verifying your account..." }
→ { type: "token", text: "Great, " }
→ { type: "token", text: "I've verified " }
→ { type: "token", text: "your account." }
→ { type: "tool_call", data: { toolName: "crm.verifyAccount", success: true } }
→ { type: "final", data: { replyText: "Great, I've verified your account..." } }
```

The React app handles these in the [WebSocket message handler](../apps/web/src/app/customer/hooks/use-conversation-session.ts) (line 187):

```typescript
// use-conversation-session.ts:187-344

socket.onmessage = (event) => {
  const payload = JSON.parse(event.data);

  if (payload.type === "token") {
    // Append to current message
    setMessages(prev => prev.map(msg =>
      msg.id === messageId ? { ...msg, text: msg.text + text } : msg
    ));
  }

  if (payload.type === "final") {
    // Message complete
  }

  if (payload.type === "tool_call") {
    // Log for debugging
    logEvent("tool_call", { toolName, args, result });
  }
};
```

**Related code:**
- [WebSocket onmessage handler (line 187)](../apps/web/src/app/customer/hooks/use-conversation-session.ts)
- [Token handling (line 228)](../apps/web/src/app/customer/hooks/use-conversation-session.ts)
- [Final message handling (line 257)](../apps/web/src/app/customer/hooks/use-conversation-session.ts)
- [Tool call logging (line 311)](../apps/web/src/app/customer/hooks/use-conversation-session.ts)

---

## Part 2: The Evaluation System

How do we know if the bot is doing a good job? The analyzer runs test scenarios and scores them.

### Step 1: Define a Scenario

Scenarios live in [apps/worker/src/analyzer/scenarios](../apps/worker/src/analyzer/scenarios):

```typescript
// cancel.ts

{
  id: "cancel-happy-path",
  name: "Cancel - Happy Path",
  category: "cancel",

  setup: {
    phone: "+14155551234",
    zip: "98109",
    seedCustomer: true,      // Create test customer
    seedAppointment: true,   // Create appointment to cancel
  },

  steps: [
    {
      userMessage: "Hi, I need to cancel my appointment",
      expectations: {
        responsePatterns: ["verify|zip"],  // Should ask for verification
      },
    },
    {
      userMessage: "98109",
      expectations: {
        toolCalls: [{ name: "crm.verifyAccount" }],
        stateChanges: { "conversation.verification.verified": true },
      },
    },
    {
      userMessage: "Yes, please cancel it",
      expectations: {
        toolCalls: [{ name: "crm.cancelAppointment" }],
      },
    },
  ],
}
```

**Related code:**
- [Scenario registry - index.ts](../apps/worker/src/analyzer/scenarios/index.ts) - All scenarios
- [Cancel scenarios - cancel.ts](../apps/worker/src/analyzer/scenarios/cancel.ts)
- [Verification scenarios - verification.ts](../apps/worker/src/analyzer/scenarios/verification.ts)
- [Reschedule scenarios - reschedule.ts](../apps/worker/src/analyzer/scenarios/reschedule.ts)
- [Scenario types - types.ts](../apps/worker/src/analyzer/types.ts)

---

### Step 2: Runner Executes Against Live API

The [ScenarioRunner](../apps/worker/src/analyzer/runner.ts) executes scenarios (line 64):

```typescript
// runner.ts:95-315 (simplified)

async runScenario(scenario) {
  const conversationId = `analyzer-${scenario.id}-${uuid}`;

  // Seed test data
  await this.seedCustomer(scenario);
  await this.seedAppointment(scenario);

  // Execute each step
  for (const step of scenario.steps) {
    // Send message to real API
    const response = await fetch(`/api/conversations/${conversationId}/message`, {
      body: JSON.stringify({ text: step.userMessage, phone: scenario.setup.phone }),
    });

    // Get debug state
    const debug = await fetch(`/api/conversations/${conversationId}/debug`);

    // Check expectations
    const passed = this.checkExpectations(step.expectations, response, debug);
  }

  return { passed, stepResults };
}
```

**Related code:**
- [ScenarioRunner class (line 64)](../apps/worker/src/analyzer/runner.ts)
- [runScenario method (line 95)](../apps/worker/src/analyzer/runner.ts)
- [checkExpectations method (line 475)](../apps/worker/src/analyzer/runner.ts)
- [seedCustomer method (line 413)](../apps/worker/src/analyzer/runner.ts)
- [seedAppointment method (line 432)](../apps/worker/src/analyzer/runner.ts)

---

### Step 3: AI Evaluates Conversation Quality

Pass/fail tells us if tools were called correctly. But was the conversation *good*? The [ConversationEvaluator](../apps/worker/src/analyzer/evaluator.ts) scores it (line 106):

```typescript
// evaluator.ts:136-202 (simplified)

async analyze(scenario, result) {
  const transcript = this.formatTranscript(result.stepResults);
  // "Customer: Hi, I need to cancel my appointment"
  // "Bot: I can help with that. What's your ZIP code?"

  const prompt = `
    Analyze this conversation. Score 0-100 on:
    - Accuracy: Did it understand and use tools correctly?
    - Naturalness: Did it sound human?
    - Efficiency: Did it minimize unnecessary turns?
    - Best Practices: Did it follow greeting/verification/closing patterns?

    Be strict. 90+ is rare.
  `;

  const response = await this.ai.run("@cf/meta/llama-3.3-70b-instruct", {
    messages: [{ role: "system", content: prompt }],
  });

  return {
    overallScore: 72,
    findings: [
      { category: "improvement", description: "Greeting was slightly robotic" },
    ],
    recommendations: ["Use more natural phrasing in opening"],
  };
}
```

**Related code:**
- [ConversationEvaluator class (line 106)](../apps/worker/src/analyzer/evaluator.ts)
- [analyze method (line 136)](../apps/worker/src/analyzer/evaluator.ts)
- [buildAnalysisPrompt method (line 230)](../apps/worker/src/analyzer/evaluator.ts) - Full prompt with best practices
- [Best practices reference - best-practices.ts](../apps/worker/src/analyzer/best-practices.ts) - Scoring criteria
- [Analysis response schema (line 33)](../apps/worker/src/analyzer/evaluator.ts)

---

### Step 4: Run Evaluations

```bash
# Run cancel scenarios with AI analysis
bun run scripts/run-analyzer.ts --category cancel --with-analysis

# Output:
# cancel-happy-path: PASS (AI Score: 72)
#   - Step 1: ✓ Asked for verification
#   - Step 2: ✓ Called verifyAccount, state updated
#   - Step 3: ✓ Called cancelAppointment
#   Findings:
#     - [improvement] Greeting was slightly robotic
```

**Related code:**
- [CLI script - run-analyzer.ts](../scripts/run-analyzer.ts)
- [Analyzer route - analyzer.ts](../apps/worker/src/routes/analyzer.ts) - RPC endpoint

---

## Key Architecture Principles

1. **Durable Objects = Stateful Conversations**
   Each conversation gets its own DO instance with persistent state.

2. **Tool Gating**
   Tools like `cancelAppointment` only become available after verification.
   See: [getAvailableTools in tool-definitions.ts](../apps/worker/src/models/tool-definitions.ts)

3. **Domain Logic in Tools, Not Session**
   The session is generic. All business rules live in [tool handlers](../apps/worker/src/durable-objects/conversation-session/tool-flow/handlers).

4. **Streaming First**
   Tokens stream via WebSocket for real-time UI updates.
   See: [Event emitter - events.ts](../apps/worker/src/durable-objects/conversation-session/v2/events.ts)

5. **Evaluation-Driven**
   Scenarios define expected behavior. AI scoring catches quality issues.
   See: [Scenarios](../apps/worker/src/analyzer/scenarios)

---

## Quick File Reference

| What | Where |
|------|-------|
| WebSocket/HTTP hook | [use-conversation-session.ts](../apps/web/src/app/customer/hooks/use-conversation-session.ts) |
| Worker entry/routing | [index.ts](../apps/worker/src/index.ts) |
| Conversation session DO | [session.ts](../apps/worker/src/durable-objects/conversation-session/v2/session.ts) |
| Tool definitions | [tool-definitions.ts](../apps/worker/src/models/tool-definitions.ts) |
| Tool handlers | [handlers](../apps/worker/src/durable-objects/conversation-session/tool-flow/handlers) |
| Scenario definitions | [scenarios](../apps/worker/src/analyzer/scenarios) |
| Scenario runner | [runner.ts](../apps/worker/src/analyzer/runner.ts) |
| AI evaluator | [evaluator.ts](../apps/worker/src/analyzer/evaluator.ts) |

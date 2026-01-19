# PestCall Architecture Walkthrough

> Follow a customer conversation from click to response, then see how we evaluate it.

---

## Part 1: The Conversation Flow

Let's trace what happens when a customer says "Hi, I need to cancel my appointment."

### Step 1: User Clicks "Start Call"

The React app calls the `useConversationSession` hook:

```typescript
// apps/web/src/app/customer/hooks/use-conversation-session.ts

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

---

### Step 2: WebSocket Connects to Durable Object

The worker routes the connection to a Durable Object - a stateful instance that lives for this conversation:

```typescript
// apps/worker/src/index.ts (simplified)

if (url.pathname.match(/\/api\/conversations\/([^/]+)\/socket/)) {
  const conversationId = match[1];

  // Get or create Durable Object for this conversation
  const id = env.CONVERSATION_SESSION_V2.idFromName(conversationId);
  const stub = env.CONVERSATION_SESSION_V2.get(id);

  return stub.fetch(request);  // Hand off to DO
}
```

The Durable Object (`ConversationSessionV2`) handles the WebSocket upgrade and is now ready to receive messages.

---

### Step 3: User Sends a Message

When the user types "Hi, I need to cancel my appointment", the web app:

```typescript
// apps/web/src/app/customer/hooks/use-conversation-session.ts

const sendMessage = useCallback(async (message: string) => {
  // POST to the conversation endpoint
  await fetch(`/api/conversations/${sessionId}/message`, {
    method: "POST",
    body: JSON.stringify({ phoneNumber, text: message }),
  });
}, [...]);
```

---

### Step 4: Durable Object Processes the Message

The DO receives the message and runs the agent loop:

```typescript
// apps/worker/src/durable-objects/conversation-session/v2/session.ts (simplified)

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
  // ...
}
```

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

---

### Step 6: Tool Handler Executes

The session looks up the handler and runs it:

```typescript
// apps/worker/src/durable-objects/conversation-session/tool-flow/registry.ts

export const toolHandlerRegistry = {
  "crm.verifyAccount": handleVerifyAccount,
  "crm.cancelAppointment": handleCancelAppointment,
  // ...
};
```

```typescript
// apps/worker/src/durable-objects/conversation-session/tool-flow/handlers/verify-account.ts (simplified)

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

---

### Step 7: State Updates, More Tools Become Available

After verification, the tool gating changes:

```typescript
// apps/worker/src/models/tool-definitions.ts

"crm.cancelAppointment": {
  description: "Cancel a scheduled appointment.",
  requiresVerification: true,  // Now available!
  // ...
}
```

Now when the user confirms "Yes, please cancel it", the AI can call `crm.cancelAppointment`.

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

The React app updates the UI in real-time as tokens arrive.

---

## Part 2: The Evaluation System

How do we know if the bot is doing a good job? The analyzer runs test scenarios and scores them.

### Step 1: Define a Scenario

```typescript
// apps/worker/src/analyzer/scenarios/cancel.ts

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

---

### Step 2: Runner Executes Against Live API

```typescript
// apps/worker/src/analyzer/runner.ts (simplified)

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

---

### Step 3: AI Evaluates Conversation Quality

Pass/fail tells us if tools were called correctly. But was the conversation *good*? AI scores it:

```typescript
// apps/worker/src/analyzer/evaluator.ts (simplified)

async analyze(scenario, result) {
  const transcript = this.formatTranscript(result.stepResults);
  // "Customer: Hi, I need to cancel my appointment"
  // "Bot: I can help with that. What's your ZIP code?"
  // ...

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

---

## Key Architecture Principles

1. **Durable Objects = Stateful Conversations**
   Each conversation gets its own DO instance with persistent state.

2. **Tool Gating**
   Tools like `cancelAppointment` only become available after verification.

3. **Domain Logic in Tools, Not Session**
   The session is generic. All business rules live in tool handlers.

4. **Streaming First**
   Tokens stream via WebSocket for real-time UI updates.

5. **Evaluation-Driven**
   Scenarios define expected behavior. AI scoring catches quality issues.

---

## Quick File Reference

| What | Where |
|------|-------|
| WebSocket/HTTP hook | `apps/web/src/app/customer/hooks/use-conversation-session.ts` |
| Worker entry/routing | `apps/worker/src/index.ts` |
| Conversation session DO | `apps/worker/src/durable-objects/conversation-session/v2/session.ts` |
| Tool definitions | `apps/worker/src/models/tool-definitions.ts` |
| Tool handlers | `apps/worker/src/durable-objects/conversation-session/tool-flow/handlers/` |
| Scenario definitions | `apps/worker/src/analyzer/scenarios/` |
| Scenario runner | `apps/worker/src/analyzer/runner.ts` |
| AI evaluator | `apps/worker/src/analyzer/evaluator.ts` |

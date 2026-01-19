# PestCall AI Agent Architecture

> A comprehensive guide to the AI customer service agent for pest control.

---

## Table of Contents

1. [Overview](#overview)
2. [Repository Structure](#repository-structure)
3. [Entry Points](#entry-points)
4. [Conversation Flow](#conversation-flow)
5. [Model Strategy](#model-strategy)
6. [Prompt Design](#prompt-design)
7. [Tool System](#tool-system)
8. [Acknowledgements and Latency](#acknowledgements-and-latency)
9. [RAG for Company Context](#rag-for-company-context)
10. [Keeping the Bot On-Topic](#keeping-the-bot-on-topic)
11. [Known Issues and Limitations](#known-issues-and-limitations)
12. [Lessons Learned](#lessons-learned)
13. [File Reference](#file-reference)

---

## Overview

PestCall is an AI-powered phone support agent that handles:
- **Customer verification** via ZIP code
- **Appointment management** (cancel, reschedule)
- **Billing inquiries**
- **Ticket creation and escalation**

Built on Cloudflare Workers with Durable Objects for stateful conversations, WebSocket streaming for real-time responses, and Workers AI for inference.

**Two main entry points:**
1. `/customer` - Real-time chat interface for customers
2. `/agent` - Dashboard for managing prompts and viewing calls

---

## Repository Structure

```
cs-agent/
├── apps/
│   ├── worker/              # Cloudflare Worker API
│   │   ├── src/
│   │   │   ├── durable-objects/
│   │   │   │   └── conversation-session/
│   │   │   │       ├── v2/             # Main session implementation
│   │   │   │       │   ├── session.ts  # Core coordinator
│   │   │   │       │   ├── providers/  # Tool and prompt providers
│   │   │   │       │   ├── state.ts    # State management
│   │   │   │       │   └── events.ts   # WebSocket event streaming
│   │   │   │       └── tool-flow/      # Tool handlers
│   │   │   ├── models/                 # AI model adapters
│   │   │   │   ├── workers-ai.ts       # Workers AI adapter
│   │   │   │   ├── openrouter.ts       # OpenRouter adapter
│   │   │   │   └── tool-definitions.ts # All tool schemas
│   │   │   ├── rag/                    # Knowledge retrieval
│   │   │   ├── analyzer/               # Evaluation system
│   │   │   ├── routes/                 # HTTP endpoints
│   │   │   ├── repositories/           # D1 database access
│   │   │   └── use-cases/              # Business logic
│   │   └── migrations/                 # D1 SQL migrations
│   │
│   └── web/                 # Next.js 14 UI
│       └── src/app/
│           ├── customer/    # Customer chat interface
│           └── agent/       # Agent dashboard
│
├── packages/
│   └── core/                # Shared Zod schemas and types
│
├── scripts/
│   └── run-analyzer.ts      # CLI for running evaluations
│
└── evaluations/             # Test results and transcripts
```

### Where to Find Things

| What you're looking for | Location |
|------------------------|----------|
| Main agent logic | `apps/worker/src/durable-objects/conversation-session/v2/session.ts` |
| Tool definitions | `apps/worker/src/models/tool-definitions.ts` |
| Tool handlers | `apps/worker/src/durable-objects/conversation-session/tool-flow/handlers/` |
| Prompt building | `apps/worker/src/durable-objects/conversation-session/v2/providers/prompt-provider.ts` |
| WebSocket handling | `apps/worker/src/index.ts` (routing) + `session.ts` (DO) |
| Evaluation scenarios | `apps/worker/src/analyzer/scenarios/` |
| Customer chat UI | `apps/web/src/app/customer/` |

---

## Entry Points

### Customer Chat (`/customer`)

The customer-facing real-time chat interface.

**Flow:**
1. User clicks "Start Call" in `apps/web/src/app/customer/page.tsx`
2. `useConversationSession` hook opens WebSocket to `/api/conversations/{id}/socket`
3. Worker routes to Durable Object via `env.CONVERSATION_SESSION_V2.idFromName(id)`
4. DO sends greeting and awaits messages
5. User messages POST to `/api/conversations/{id}/message`
6. DO processes with AI, streams tokens back via WebSocket

**Key files:**
- `apps/web/src/app/customer/hooks/use-conversation-session.ts` - React hook
- `apps/worker/src/index.ts:166-214` - WebSocket routing
- `apps/worker/src/durable-objects/conversation-session/v2/session.ts` - Session DO

### Agent Dashboard (`/agent`)

Internal dashboard with four tabs:
- **Calls** - View recent call transcripts
- **Prompts** - Edit system prompts and persona
- **Company** - Manage company knowledge (RAG)
- **Tickets** - View escalation tickets

**Key files:**
- `apps/web/src/app/agent/page.tsx` - Dashboard layout
- `apps/worker/src/routes/agent-config.ts` - Prompt config API

### Evaluation System

Run scenario-based tests against the live API:

```bash
bun run scripts/run-analyzer.ts --category cancel --with-analysis --save
```

**Key files:**
- `scripts/run-analyzer.ts` - CLI entry
- `apps/worker/src/analyzer/runner.ts` - Executes scenarios
- `apps/worker/src/analyzer/evaluator.ts` - AI scoring
- `apps/worker/src/analyzer/scenarios/` - Test definitions

---

## Conversation Flow

### Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                     Generic Agent Layer                         │
│  (WebSocket, state coordination, model calls, event streaming)  │
│                                                                 │
│  - No domain concepts (appointments, verification)              │
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
│  - All business logic lives here                               │
└─────────────────────────────────────────────────────────────────┘
```

**Why this separation?** The generic agent can be reused for different domains. All PestCall-specific logic (verification, appointments, workflows) lives in the configuration layer.

### Message Processing

1. **Receive message** via HTTP POST to `/message`
2. **Build system prompt** via `promptProvider.buildSystemPrompt(state)`
3. **Get available tools** via `toolProvider.getTools(state)` (filtered by verification status)
4. **Call AI model** with messages + tools
5. **Execute tool calls** if any, updating domain state
6. **Stream response** tokens to WebSocket
7. **Emit final event** with complete response

---

## Model Strategy

### The Challenge

We need two very different capabilities:
1. **Function calling** - Reliable tool invocation with correct arguments
2. **Natural conversation** - Human-like responses that don't sound robotic

No single model excels at both in a cost-effective way.

### Current Approach: Workers AI

**Primary model:** `@hf/nousresearch/hermes-2-pro-mistral-7b`
- Good function calling accuracy for its size
- Low latency (runs on Cloudflare edge)
- Cost-effective (free tier available)

**Evaluation model:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- Better reasoning for scoring conversations
- Used only in offline evaluation, not live calls

### Alternative: OpenRouter

For higher quality responses, we support OpenRouter via Cloudflare AI Gateway:

```typescript
// .dev.vars
AGENT_MODEL=openrouter
OPENROUTER_API_KEY=...
```

This routes to external models (GPT-4, Claude, etc.) but adds latency.

### Hybrid Strategy (Experimental)

`apps/worker/src/models/hybrid.ts` allows:
- Workers AI for tool routing (fast, edge)
- OpenRouter for response generation (quality)

Not fully productionized due to complexity in managing two model calls.

### Why Not Just Use Better Models?

We could have used OpenAI's Realtime API, Claude, or other more capable models. In the short time available, we were committed to Cloudflare's stack and didn't want to start over from scratch.

For a production system, we'd want to evaluate Claude, OpenAI, and other providers that offer better function calling accuracy and more natural conversation.

---

## Prompt Design

### Philosophy

The prompts are designed around one core insight: **shorter prompts produce more reliable function calls** with smaller models.

We learned this the hard way. Early prompts were comprehensive guides explaining every tool and edge case. The model would get confused and call wrong tools or hallucinate IDs.

### Current Structure

**Pre-verification prompt** (lines 115-142 in prompt-provider.ts):
```
You are a friendly {company} customer service agent on a phone call.

CRITICAL: You MUST verify the customer before helping them.

STEP 1 - ASK FOR ZIP (do NOT call any tools yet):
- Greet the customer warmly
- Ask for their ZIP code to pull up their account

STEP 2 - VERIFY (only after customer provides a 5-digit ZIP):
- Call crm.verifyAccount with that ZIP
- After verification succeeds, greet them by name

IMPORTANT RULES:
- Do NOT call crm.verifyAccount until customer gives 5-digit ZIP
- If customer says something else, acknowledge and ask again

RESPONSE FORMAT (THIS IS A PHONE CALL):
- Speak naturally - no markdown, bullets, numbered lists
- Say dates casually: 'February 10th' not 'February 10, 2025'
```

**Post-verification prompt** (lines 146-169):
```
You are a helpful {company} customer service agent on a phone call.
The customer is VERIFIED. You have full access to their account.

APPOINTMENT WORKFLOW:
1. FIRST: Call crm.listUpcomingAppointments
2. Tell customer what appointments they have
3. When they confirm, use crm.cancelAppointment or crm.rescheduleAppointment
   with the EXACT id from step 1

CRITICAL RULES:
- Appointment IDs look like 'appt_001'. ONLY use IDs from tool results
- NEVER invent appointment IDs
- NEVER ask customer for IDs
```

### Key Design Decisions

1. **Two-phase prompts**: Different prompts for verified vs. unverified. Reduces confusion about what tools are available.

2. **Explicit formatting rules**: "THIS IS A PHONE CALL" repeated because models default to written formatting. Had many issues with bots saying "1. First option, 2. Second option" on phone calls.

3. **Step-by-step instructions**: Rather than describing tools abstractly, we say exactly what to do. "FIRST call X, THEN call Y."

4. **Negative rules**: "Do NOT call X until Y" is more reliable than "Call X when Y."

5. **ID handling**: Extensive rules about appointment IDs because the model frequently hallucinated IDs like "123" or "12345" instead of using actual IDs from tool results.

---

## Tool System

### Tool Definitions

Each tool has:
- **description**: What the model sees
- **inputSchema**: Zod schema for validation
- **acknowledgement**: Message while executing (see next section)
- **requiresVerification**: Gating flag

```typescript
// tool-definitions.ts
"crm.cancelAppointment": {
  description: "Cancel a scheduled appointment.",
  inputSchema: z.object({
    appointmentId: z.string().describe("ID from crm.listUpcomingAppointments"),
  }),
  requiresVerification: true,
  acknowledgement: "Canceling that appointment for you now.",
}
```

### Tool Gating

Tools are filtered based on state:

```typescript
function getAvailableTools(state: ToolGatingState) {
  // Before verification: only verifyAccount, getServicePolicy
  // After verification: full tool set
  // During workflow: add workflow-specific tools
}
```

This prevents the model from calling tools it shouldn't have access to.

### Tool Handlers

Each tool has a handler in `tool-flow/handlers/`:

```typescript
// handlers/cancel-appointment.ts
export async function handleCancelAppointment(ctx, { args }) {
  const result = await ctx.deps.crm.cancelAppointment(args.appointmentId);
  return {
    result: { success: true, message: "Appointment canceled" },
    stateUpdates: { cancelWorkflowId: null },
  };
}
```

Handlers return:
- **result**: Passed back to the model
- **stateUpdates**: Applied to domain state

---

## Acknowledgements and Latency

### The Problem

Tool execution takes time (100ms-1000ms). During this silence, customers wonder if the call dropped.

### Solution: Acknowledgements

Each tool can define an acknowledgement message shown immediately while the tool executes:

```typescript
"crm.verifyAccount": {
  acknowledgement: "Got it—verifying your account now.",
}
```

The flow:
1. Model calls tool
2. **Immediately** send acknowledgement to WebSocket
3. Execute tool (which takes time)
4. Model generates response with tool result

Customer hears: "Got it—verifying your account now." *[brief pause]* "Great, I've verified your account, John!"

### Conditional Acknowledgements

Some tools skip acknowledgements when data is cached:

```typescript
"crm.listUpcomingAppointments": {
  acknowledgement: (domainState) => {
    const hasAppointments = Boolean(
      domainState.conversation?.appointments?.length
    );
    return hasAppointments ? null : "Let me list your upcoming appointments.";
  },
}
```

If we already fetched appointments, don't say "Let me check" again.

### Other Latency Optimizations

1. **Edge deployment**: Workers AI runs on Cloudflare edge, ~20-50ms inference
2. **Streaming**: Tokens stream as generated, not buffered
3. **Parallel tool calls**: Not currently implemented but planned
4. **Connection reuse**: WebSocket stays open for duration of call

### What We'd Do Differently

For truly low-latency voice, we would likely use:

- **OpenAI Realtime API**: Purpose-built for voice with ~100ms latency
- **ElevenLabs or similar TTS**: Specialized voice synthesis

Our current approach (text streaming + external TTS) adds latency from:
- Model inference
- WebSocket delivery
- TTS generation
- Audio playback

The OpenAI Realtime API handles all of this in one optimized pipeline.

---

## RAG for Company Context

### Purpose

Provide the agent with company-specific knowledge (pricing, policies, service areas) without bloating the system prompt.

### Implementation

```
apps/worker/src/rag/
├── index.ts      # Exports
├── retriever.ts  # Vector search
├── embedder.ts   # Generate embeddings
├── chunker.ts    # Split documents
└── seeder.ts     # Populate knowledge base
```

### How It Works

1. **Seed**: Markdown documents are chunked and embedded
2. **Query**: User messages are embedded and matched against vectors
3. **Retrieve**: Top 3 relevant chunks added to prompt

```typescript
const retriever = createKnowledgeRetriever({
  ai: env.AI,
  vectorize: env.KNOWLEDGE_VECTORS,
});

const result = await retriever.retrieve("How much does termite treatment cost?");
// → Top 3 chunks about pricing
```

### Current Status

RAG is implemented but **not fully integrated** into the live conversation flow. The infrastructure exists but we haven't written the company documentation to seed it with.

---

## Keeping the Bot On-Topic

### Challenge

LLMs want to be helpful. Ask about the weather and they'll happily discuss it. For a customer service bot, this is a problem.

### Strategies

1. **Tool gating**: The model can only do what tools allow. No tool for "discuss weather" means no weather discussion.

2. **Prompt scoping**: "You are a PestCall customer service agent" establishes identity.

3. **Explicit boundaries**: The prompt includes scope messages about what the bot can and cannot help with.

4. **Intent detection**: Before processing, we detect if the message relates to known intents (cancel, reschedule, billing). Off-topic messages get a polite redirect.

5. **Escalation**: For genuinely stuck situations, the bot can escalate to a human agent.

### What's Missing

- **Off-topic classifier**: We don't have a robust classifier for off-topic messages
- **Repeated off-topic handling**: No special handling for users who repeatedly go off-topic
- **Human handoff**: Escalation creates a ticket but doesn't do live transfer

---

## Known Issues and Limitations

### Function Call Accuracy

**The biggest issue.** Small models frequently:
- Call tools with wrong arguments
- Hallucinate appointment IDs
- Skip verification steps
- Call tools in wrong order

We've mitigated this with:
- Shorter, more explicit prompts
- Step-by-step instructions
- ID validation in handlers
- Gating to prevent invalid tool calls

But it's not solved. Some percentage of calls still fail due to model errors.

### Latency

Current end-to-end latency (message to first token) is ~200-500ms. For natural conversation, this should be <100ms.

### No True Voice

This is a text chat pretending to be a phone call. For production, you'd want:
- Speech-to-text on input
- Text-to-speech on output
- Interrupt handling (barge-in)
- Silence detection

RealtimeKit integration exists but isn't production-ready.

### Limited Workflows

Currently supports:
- Verification
- Cancel appointment
- Reschedule appointment
- List invoices

Missing:
- Schedule new appointment
- Make payment
- Update contact info
- Complex multi-step workflows

### CRM Integration

Currently uses mock CRM adapters. Real integration would need:
- Authentication
- Error handling
- Rate limiting
- Data sync

---

## Lessons Learned

### 1. Smaller Models Need Simpler Prompts

Our first prompts were 2000+ tokens of detailed instructions. The model performed worse than with 500 tokens of clear, step-by-step rules.

### 2. Function Calling is Hard

We initially expected function calling to "just work." It doesn't. Models frequently:
- Invent arguments
- Call tools in wrong contexts
- Ignore tool results

Every tool needs validation and error handling.

### 3. Evaluation is Essential

Without the analyzer running scenarios, we'd have no idea if changes improved or broke things. The AI scoring catches issues that pass/fail metrics miss.

### 4. Streaming Matters More Than Quality

For real-time conversation, users prefer a fast mediocre response over a slow perfect one. That's why we use edge-deployed Workers AI instead of GPT-4.

### 5. State Management is Complex

Tracking verification status, active workflows, cached data, pending selections—it adds up. The domain state abstraction helps but isn't perfect.

### What We'd Do Differently

If starting over:

1. **Use OpenAI Realtime API** for true voice with low latency
2. **Use a larger model** (GPT-4, Claude) for the main agent if budget allows
3. **Build a proper state machine** for workflows instead of ad-hoc flags
4. **Start with evaluation first** before building features
5. **Use LangChain or similar** for tool orchestration patterns

We built custom infrastructure that LangChain/LlamaIndex already provide. Not necessarily wrong, but significant development time.

---

## File Reference

### Core Session

| File | Purpose |
|------|---------|
| `v2/session.ts` | Main session coordinator, message handling |
| `v2/state.ts` | Session state management |
| `v2/events.ts` | WebSocket event streaming |
| `v2/connection.ts` | Connection management |
| `v2/providers/tool-provider.ts` | Tool definitions wrapper |
| `v2/providers/prompt-provider.ts` | Prompt building |

### Tools

| File | Purpose |
|------|---------|
| `models/tool-definitions.ts` | All tool schemas and metadata |
| `tool-flow/registry.ts` | Tool name to handler mapping |
| `tool-flow/handlers/*.ts` | Individual tool implementations |

### Models

| File | Purpose |
|------|---------|
| `models/workers-ai.ts` | Workers AI adapter |
| `models/openrouter.ts` | OpenRouter adapter |
| `models/hybrid.ts` | Experimental hybrid routing |
| `models/types.ts` | Model adapter interfaces |

### Evaluation

| File | Purpose |
|------|---------|
| `analyzer/runner.ts` | Executes test scenarios |
| `analyzer/evaluator.ts` | AI scoring of conversations |
| `analyzer/scenarios/*.ts` | Test scenario definitions |
| `analyzer/best-practices.ts` | Scoring criteria |

### Web

| File | Purpose |
|------|---------|
| `customer/hooks/use-conversation-session.ts` | Chat hook |
| `customer/page.tsx` | Chat UI |
| `agent/page.tsx` | Dashboard |

---

## Further Reading

- [Evaluation Guide](evaluation-improvement-guide.md) - Using evaluations to improve the bot
- [Styleguide](styleguide.md) - Code patterns
- [Testing](testing.md) - Test structure

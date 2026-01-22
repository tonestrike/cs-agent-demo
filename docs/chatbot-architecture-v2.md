# PestCall AI Agent Architecture v2.0

## Comprehensive Analysis and Recommendations for Next-Generation Voice AI Customer Service

**Document Version:** 2.0
**Date:** January 2026
**Authors:** Architecture Review Team

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Key Findings and Pain Points](#key-findings-and-pain-points)
4. [Recommended Architecture](#recommended-architecture)
5. [Provider Comparison](#provider-comparison)
6. [Real-Time Voice Solutions](#real-time-voice-solutions)
7. [Orchestration Framework Analysis](#orchestration-framework-analysis)
8. [Function Calling Best Practices](#function-calling-best-practices)
9. [Deployment Strategy](#deployment-strategy)
10. [Implementation Roadmap](#implementation-roadmap)
11. [Cost Analysis](#cost-analysis)
12. [Production Readiness](#production-readiness)
13. [Risk Mitigation](#risk-mitigation)
14. [Appendix: Code Examples](#appendix-code-examples)
15. [Evaluation Strategy](#evaluation-strategy)
16. [Acknowledgement Messages and Progressive Response](#acknowledgement-messages-and-progressive-response)
17. [Barge-In (Interruption Handling)](#barge-in-interruption-handling)

---

## Executive Summary

This document provides a comprehensive analysis of the current PestCall chatbot prototype and presents recommendations for building a production-grade, real-time voice AI customer service system. Based on extensive research of Anthropic, OpenAI, LangChain, and various voice AI platforms, we recommend a hybrid architecture that leverages:

- **OpenAI Realtime API or LiveKit** for low-latency voice interactions
- **Claude (Anthropic) or GPT-4** for primary LLM reasoning with superior function calling
- **LangGraph** for complex stateful workflows (optional, depending on complexity)
- **Cloudflare AI Gateway** for multi-provider routing, caching, and observability
- **Cloudflare Durable Objects** for session state management (retained from current architecture)

### Key Recommendations Summary

| Area | Current | Recommended | Impact |
|------|---------|-------------|--------|
| **Primary LLM** | Workers AI (Hermes 7B) | Claude Sonnet 4 or GPT-4o | 60%+ improvement in function calling accuracy |
| **Voice Pipeline** | Text chat (simulated voice) | OpenAI Realtime or LiveKit | True <500ms voice latency |
| **State Management** | Custom Durable Objects | Keep + enhance with LangGraph patterns | Better workflow handling |
| **Orchestration** | Custom tool loop | Direct API or LangGraph | Reduced complexity, better reliability |
| **Infrastructure** | Pure Cloudflare | Cloudflare AI Gateway + external LLMs | Best of both worlds |

### Decision: LiveKit + Claude (January 2026)

After evaluation, we have selected **Option B: LiveKit + Claude** as our target architecture:

```
┌─────────────┐     ┌─────────────────────────────────────┐
│   Phone     │────▶│         LiveKit Agents              │
│   WebRTC    │     │  ┌──────┐  ┌─────┐  ┌───────────┐  │
└─────────────┘     │  │Silero│─▶│Deep-│─▶│  Claude   │  │
                    │  │ VAD  │  │gram │  │ Sonnet 4  │  │
                    │  └──────┘  └─────┘  └─────┬─────┘  │
                    │                          │         │
                    │                    ┌─────▼─────┐   │
                    │                    │ Cartesia  │   │
                    │                    │   TTS     │   │
                    │                    └───────────┘   │
                    └─────────────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  Cloudflare (Existing)      │
                    │  • Durable Objects (state)  │
                    │  • AI Gateway (routing)     │
                    │  • Vectorize (RAG)          │
                    └─────────────────────────────┘
```

**Rationale:**
- **Cost efficiency**: ~$0.07/min vs $0.10/min for OpenAI Realtime (~30% savings)
- **Superior function calling**: Claude Sonnet 4 has 95%+ accuracy with strict mode
- **Component flexibility**: Can swap STT/TTS/LLM providers independently
- **Infrastructure reuse**: Keeps existing Durable Objects, Vectorize, and tool implementations
- **Latency target**: <500ms achievable with Deepgram Nova-3 + Cartesia

**Selected Stack:**
| Component | Provider | Why |
|-----------|----------|-----|
| **Voice Infrastructure** | LiveKit Agents | Open source, flexible, WebRTC + telephony |
| **VAD** | Silero | Fast, accurate, built into LiveKit |
| **STT** | Deepgram Nova-3 | <300ms latency, 6.84% WER, best price/performance |
| **LLM** | Claude Sonnet 4 | Best function calling, strict mode support |
| **TTS** | Cartesia Sonic | 75ms latency, natural voice quality |
| **State** | Cloudflare Durable Objects | Keep existing implementation |
| **Routing** | Cloudflare AI Gateway | Multi-provider fallback, caching, observability |

---

## Current State Analysis

### Architecture Overview

The current PestCall prototype is built on:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Current Architecture                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │ Next.js  │───▶│  Cloudflare  │───▶│   Durable Objects    │  │
│  │   UI     │    │   Worker     │    │ (ConversationSession)│  │
│  └──────────┘    └──────────────┘    └──────────────────────┘  │
│                                              │                  │
│                                              ▼                  │
│                         ┌────────────────────────────────┐     │
│                         │        Workers AI              │     │
│                         │  (Hermes 2 Pro Mistral 7B)     │     │
│                         └────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Strengths

1. **Clean Separation of Concerns**: Generic agent layer vs. configuration layer is well-designed
2. **Tool Gating**: Proper verification-based tool access control
3. **Acknowledgement System**: Good UX pattern for handling tool execution latency
4. **State Management**: Durable Objects provide reliable session persistence
5. **Evaluation System**: AI-powered scenario testing is a strong foundation
6. **Streaming Support**: WebSocket-based token streaming is implemented

### Identified Issues

Based on the architecture documentation and code review:

| Issue | Severity | Description |
|-------|----------|-------------|
| **Function Calling Accuracy** | Critical | Hermes 7B frequently hallucinates appointment IDs, calls wrong tools, skips verification |
| **No True Voice** | Critical | Text-based chat simulating phone calls; 200-500ms latency too slow for voice |
| **Tool Result Threading Broken** | Critical | Tool results passed as plain text "context" instead of proper `tool_result` messages |
| **Message History Not Updated in Loop** | High | Claude doesn't see its own tool calls or results during multi-step flows |
| **Tool Use IDs Not Tracked** | High | Cannot construct proper `tool_result` messages without preserving `tool_use_id` |
| **Prompt Complexity** | High | Required extensive prompt engineering to work around model limitations |
| **Limited Model Options** | High | Tied to Workers AI models; no easy fallback to better providers |
| **Sequential Tool Execution** | Medium | Multiple tool calls executed sequentially instead of in parallel |
| **Stale State in Tool Loop** | Medium | Session state captured once at start; tools update state but loop uses stale reference |
| **RAG Not Integrated** | Medium | Infrastructure exists but not connected to live conversations |

---

## Key Findings and Pain Points

### 1. Function Calling Reliability

**Current Problem:**
The Hermes 2 Pro Mistral 7B model has fundamental limitations with function calling:
- Invents appointment IDs ("123", "12345" instead of "appt_001")
- Calls tools with wrong arguments
- Skips verification steps
- Requires extensive negative prompting ("Do NOT...", "NEVER...")

**Industry Benchmarks (2025-2026):**

| Model | Function Call Accuracy | Instruction Following |
|-------|----------------------|----------------------|
| GPT-4o (strict mode) | 100% schema adherence | 95%+ |
| Claude Sonnet 4 | 95%+ | 97%+ |
| GPT-4.1 | 98%+ | 96%+ |
| Hermes 7B | ~70-80% | ~75% |

**Recommendation:** Switch to Claude Sonnet 4 or GPT-4o with strict mode enabled.

### 2. Voice Latency Requirements

**Current State:** 200-500ms end-to-end (text only)

**Target for Natural Voice:** <500ms total, ideally <300ms

**Latency Breakdown for Voice:**
```
Target Pipeline:
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│  STT    │───▶│   LLM   │───▶│   TTS   │───▶│  Audio  │
│ <300ms  │    │ <200ms  │    │ <100ms  │    │ Playback│
└─────────┘    └─────────┘    └─────────┘    └─────────┘
                              Total: <600ms first audio
```

### 3. Prompt Engineering Overhead

**Current Approach:**
- 2000+ tokens of detailed instructions
- Extensive negative rules
- Step-by-step workflows encoded in prompts
- Multiple prompt variants for different states

**Best Practice (2025):**
- Shorter prompts work better with capable models
- Use tool definitions for constraints, not prose
- Let the model reason; don't over-specify
- Use structured outputs / strict mode

### 4. Critical Implementation Flaws in Tool Calling Loop

A detailed code review of `session.ts` and `anthropic.ts` revealed several critical bugs in how tool calling is implemented:

#### 4.1 Tool Results Not Properly Threaded (CRITICAL)

**Location:** `runAgentLoopWithAdapter()` in `session.ts`

**Problem:** Tool results are accumulated as plain text strings and passed as "context" rather than proper Anthropic `tool_result` messages:

```typescript
// CURRENT (BROKEN):
const contextParts: string[] = [];
if (toolResults.length > 0) {
  contextParts.push("Previous tool results:");
  for (const tr of toolResults) {
    contextParts.push(`${tr.toolName}: ${tr.result}`);
  }
}
// Passed as context string, NOT as tool_result messages
```

**Why This Breaks Things:**
- Claude's tool use protocol requires `tool_result` content blocks paired with `tool_use_id`
- Without proper threading, Claude loses track of the conversation flow
- Multi-step tool chains (verify → list → cancel) fail because Claude doesn't see intermediate results correctly

**Correct Pattern:**
```typescript
// CORRECT:
messages.push({
  role: "user",
  content: [{
    type: "tool_result",
    tool_use_id: toolCall.id,  // Must match tool_use.id from Claude's response
    content: JSON.stringify(result)
  }]
});
```

#### 4.2 Message History Not Updated During Tool Loop (HIGH)

**Problem:** `messageHistory` is only updated at the end of `processMessage()`:
```typescript
// Only happens AFTER the entire loop completes
this.messageHistory.push({ role: "assistant", content: response });
```

**Impact:** During multi-tool flows, Claude doesn't see:
- Its own prior tool call decisions
- The results of those tool calls
- Any intermediate reasoning

If Claude calls `listAppointments` then `cancelAppointment`, on the second call it has **no memory** of the first call in the actual message array.

#### 4.3 Tool Use IDs Not Preserved (HIGH)

**Location:** `anthropic.ts` adapter

**Problem:** When extracting tool calls, the `id` field is discarded:
```typescript
const validated = agentToolCallSchema.safeParse({
  type: "tool_call",
  toolName: toolUse.name,
  arguments: toolUse.input,
  // MISSING: toolUseId: toolUse.id
});
```

**Impact:** Without the tool use ID, we cannot construct valid `tool_result` messages that Claude can match to its original requests.

#### 4.4 Sequential Tool Execution (MEDIUM)

**Problem:** When Claude returns multiple parallel tool calls, they're executed sequentially:
```typescript
for (const call of output.calls) {
  const result = await executor.execute(args);  // Sequential await
}
```

**Fix:** Use `Promise.all()` for parallel execution:
```typescript
const results = await Promise.all(
  output.calls.map(call => executor.execute(call.arguments))
);
```

#### 4.5 Stale State Reference (MEDIUM)

**Problem:** Session state is captured once at loop start:
```typescript
const sessionState = this.state.get();  // Captured once
const tools = this.toolProvider.getTools(sessionState);  // Uses stale state
```

Tools update state via `updateState()`, but subsequent iterations use the stale `sessionState`. This means tool gating (showing different tools based on verification status) may not work correctly mid-conversation.

#### 4.6 Error Results Missing `is_error` Flag (MEDIUM)

**Problem:** Tool errors are returned as plain JSON:
```typescript
return JSON.stringify({ error: "Tool execution failed" });
```

**Correct Pattern:** Use Anthropic's error signaling:
```typescript
{
  type: "tool_result",
  tool_use_id: "...",
  is_error: true,
  content: "Error: Appointment not found. Please call listAppointments first."
}
```

This helps Claude understand it should try a different approach.

### 5. What's Working Well

Despite the issues above, several patterns are well-implemented:

1. **Barge-in / interruption handling** - Clean `streamId` cancellation pattern
2. **Acknowledgement aggregation** - Good UX for long-running tool calls
3. **Tool gating concept** - `getTools(state)` returning different tools based on verification
4. **Turn tracking** - Solid structure for conversation turn management
5. **Event emission** - Clean WebSocket event system for streaming
6. **Builder pattern** - `SessionBuilder` provides clean dependency injection

---

## Recommended Architecture

### Option A: OpenAI Realtime API (Recommended for Voice-First)

```
┌─────────────────────────────────────────────────────────────────┐
│                  Recommended Architecture (Voice-First)         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────┐                                                 │
│  │   Phone    │──┐                                              │
│  │  (Twilio)  │  │                                              │
│  └────────────┘  │    ┌──────────────────────────────────┐     │
│                  ├───▶│    OpenAI Realtime API           │     │
│  ┌────────────┐  │    │    (gpt-4o-realtime)             │     │
│  │  WebRTC    │──┘    │    - Native speech-to-speech     │     │
│  │  Browser   │       │    - Function calling in voice   │     │
│  └────────────┘       │    - <500ms latency              │     │
│                       └──────────────┬───────────────────┘     │
│                                      │                          │
│                                      ▼                          │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │              Cloudflare Workers + Durable Objects         │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │ │
│  │  │   Session   │  │    Tool     │  │   Vectorize     │   │ │
│  │  │   State     │  │  Handlers   │  │   (RAG)         │   │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │ │
│  └───────────────────────────────────────────────────────────┘ │
│                              │                                  │
│                              ▼                                  │
│                     ┌─────────────────┐                        │
│                     │   External APIs  │                        │
│                     │   (CRM, Billing) │                        │
│                     └─────────────────┘                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Option B: LiveKit + LangGraph (Recommended for Maximum Flexibility)

```
┌─────────────────────────────────────────────────────────────────┐
│              Recommended Architecture (Flexible Stack)          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────┐    ┌────────────────────────────────────┐      │
│  │   Phone    │───▶│         LiveKit Agents             │      │
│  │  Browser   │    │  ┌──────┐  ┌─────┐  ┌──────────┐  │      │
│  │  WebRTC    │    │  │ VAD  │─▶│ STT │─▶│LLM Router│  │      │
│  └────────────┘    │  └──────┘  └─────┘  └────┬─────┘  │      │
│                    │                          │         │      │
│                    │                          ▼         │      │
│                    │            ┌─────────────────────┐ │      │
│                    │            │  Cloudflare AI GW   │ │      │
│                    │            │  (Routing/Caching)  │ │      │
│                    │            └─────────┬───────────┘ │      │
│                    │                      │             │      │
│                    │         ┌────────────┼────────────┐│      │
│                    │         ▼            ▼            ▼│      │
│                    │    ┌────────┐  ┌────────┐  ┌──────┐│      │
│                    │    │ Claude │  │ GPT-4o │  │Workers││      │
│                    │    │Sonnet 4│  │        │  │  AI  ││      │
│                    │    └────────┘  └────────┘  └──────┘│      │
│                    │                                    │      │
│                    │  ┌──────────────────────────────┐  │      │
│                    │  │            TTS               │  │      │
│                    │  │  (Cartesia / ElevenLabs)     │  │      │
│                    │  └──────────────────────────────┘  │      │
│                    └────────────────────────────────────┘      │
│                                      │                          │
│                                      ▼                          │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                 Cloudflare Edge                           │ │
│  │  ┌─────────────────┐  ┌───────────┐  ┌────────────────┐  │ │
│  │  │ Durable Objects │  │ Vectorize │  │ D1 Database    │  │ │
│  │  │ (Session State) │  │ (RAG)     │  │ (Persistence)  │  │ │
│  │  └─────────────────┘  └───────────┘  └────────────────┘  │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Option C: Hybrid with LangGraph (For Complex Workflows)

If conversation flows become more complex with multi-step workflows:

```python
# LangGraph-style state machine for complex workflows
from langgraph.graph import StateGraph, END

class ConversationState(TypedDict):
    messages: List[Message]
    customer: Optional[Customer]
    verification_status: str
    active_workflow: Optional[str]
    appointments: List[Appointment]

workflow = StateGraph(ConversationState)

# Define nodes
workflow.add_node("greet", greet_customer)
workflow.add_node("verify", verify_customer)
workflow.add_node("route_intent", classify_intent)
workflow.add_node("handle_cancel", cancel_workflow)
workflow.add_node("handle_reschedule", reschedule_workflow)
workflow.add_node("handle_billing", billing_workflow)
workflow.add_node("escalate", human_handoff)

# Define edges
workflow.set_entry_point("greet")
workflow.add_edge("greet", "verify")
workflow.add_conditional_edges("verify", check_verification, {
    "verified": "route_intent",
    "failed": "greet",
    "escalate": "escalate"
})
workflow.add_conditional_edges("route_intent", get_intent, {
    "cancel": "handle_cancel",
    "reschedule": "handle_reschedule",
    "billing": "handle_billing",
    "unknown": "escalate"
})
```

---

## Provider Comparison

### LLM Providers for Function Calling

| Provider | Model | Function Calling | Latency | Cost (1M tokens) | Recommendation |
|----------|-------|------------------|---------|------------------|----------------|
| **Anthropic** | Claude Sonnet 4 | Excellent (strict mode) | ~1s TTFT | $3 in / $15 out | **Primary choice** |
| **OpenAI** | GPT-4o | Excellent (100% schema) | ~500ms | $5 in / $15 out | Strong alternative |
| **OpenAI** | GPT-4o-mini | Very good | ~200ms | $0.15 in / $0.60 out | Cost-optimized |
| **OpenAI** | GPT-4.1 | Best (30% more efficient) | ~400ms | Varies | Latest option |
| **Anthropic** | Claude Haiku | Good | ~300ms | $0.25 in / $1.25 out | Fast fallback |
| **Cloudflare** | Llama 3.1 70B | Moderate | ~200ms | $0.011/1K neurons | Edge fallback |

### Voice Pipeline Components

| Component | Provider | Latency | Cost | Notes |
|-----------|----------|---------|------|-------|
| **STT** | Deepgram Nova-3 | <300ms | $0.0047/min | Best accuracy/speed |
| **STT** | AssemblyAI Universal | ~300ms | $0.0025/min | Semantic endpointing |
| **TTS** | Cartesia | 75ms | $0.02/min | Ultra-low latency |
| **TTS** | ElevenLabs | 100ms | $0.036/min | Best voice quality |
| **TTS** | Deepgram Aura | 150ms | $0.0108/min | Cost-effective |
| **Full Stack** | OpenAI Realtime | <500ms E2E | ~$0.10/min | Simplest integration |

---

## Real-Time Voice Solutions

### Recommended: OpenAI Realtime API

**Pros:**
- Native speech-to-speech with <500ms latency
- Built-in function calling during voice
- WebRTC and WebSocket support
- SIP integration for telephony
- Simplest architecture

**Cons:**
- Vendor lock-in to OpenAI
- Less control over individual components
- Higher cost at scale

**Implementation Pattern:**
```javascript
// Server-side: Generate ephemeral token
app.post("/api/realtime/token", async (req, res) => {
  const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-realtime-preview",
      voice: "alloy",
      tools: pestCallTools,
      instructions: systemPrompt
    })
  });

  const data = await response.json();
  res.json({ client_secret: data.client_secret });
});
```

### Alternative: LiveKit + Component Stack

**Pros:**
- Maximum flexibility (swap any component)
- Open source option
- Better cost optimization at scale
- Multi-provider LLM support

**Cons:**
- More complex to set up
- More moving parts to manage
- Requires orchestration

**Implementation Pattern:**
```python
from livekit.agents import Agent, AgentSession
from livekit.plugins import silero, deepgram, openai, cartesia

async def create_agent(ctx: JobContext):
    session = AgentSession(
        vad=silero.VAD.load(),
        stt=deepgram.STT(model="nova-3"),
        llm=openai.LLM(model="gpt-4o"),  # or anthropic.Claude()
        tts=cartesia.TTS(model="sonic-english"),
        allow_interruptions=True
    )

    # Register PestCall tools
    session.add_tool(verify_customer)
    session.add_tool(list_appointments)
    session.add_tool(cancel_appointment)
    session.add_tool(reschedule_appointment)

    await session.start(ctx.room)
```

---

## Orchestration Framework Analysis

### When to Use LangChain/LangGraph

**Use LangGraph when:**
- Complex multi-step workflows with loops and branches
- Need for human-in-the-loop approval steps
- State machines with multiple paths
- Long-running agents that need persistence
- Multi-agent coordination

**Don't use LangGraph when:**
- Simple request-response patterns
- Linear tool calling flows
- Performance-critical paths (adds latency)
- Team unfamiliar with the framework

### Recommendation for PestCall

**Current Complexity Level:** Medium
- Verification → Intent Detection → Tool Execution → Response

**Recommendation:**
1. **Short-term:** Keep current custom implementation but upgrade LLM
2. **Medium-term:** Evaluate LangGraph if workflows become more complex
3. **Use LangSmith:** Regardless of framework, use for observability

### Direct API vs Framework Comparison

| Aspect | Direct API Calls | LangChain/LangGraph |
|--------|------------------|---------------------|
| **Setup Time** | Hours | Days |
| **Flexibility** | Maximum | Constrained by abstractions |
| **Debugging** | Straightforward | Can be opaque |
| **Latency** | Minimal overhead | +10-50ms |
| **Code Size** | Larger, explicit | Smaller, declarative |
| **Provider Switching** | Manual work | Built-in |
| **Best For** | Simple flows, performance | Complex workflows, rapid prototyping |

---

## Function Calling Best Practices

### Tool Definition Best Practices (2025-2026)

#### 1. Use Detailed Descriptions

```javascript
// BAD: Minimal description
{
  name: "cancel_appointment",
  description: "Cancel an appointment",
  parameters: {
    appointmentId: { type: "string" }
  }
}

// GOOD: Detailed description with context
{
  name: "crm.cancelAppointment",
  description: `Cancel a scheduled pest control appointment.
    Call this ONLY after:
    1. Customer is verified via crm.verifyAccount
    2. Appointments listed via crm.listUpcomingAppointments
    3. Customer explicitly confirms they want to cancel

    Returns confirmation of cancellation with any applicable fees.`,
  parameters: {
    appointmentId: {
      type: "string",
      description: "Appointment ID from crm.listUpcomingAppointments (e.g., 'appt_001'). NEVER invent IDs."
    }
  },
  strict: true  // Enforce schema compliance
}
```

#### 2. Enable Strict Mode (OpenAI/Anthropic)

```javascript
// OpenAI strict mode
const tools = [{
  type: "function",
  function: {
    name: "cancel_appointment",
    strict: true,  // 100% schema adherence
    parameters: {
      type: "object",
      properties: {
        appointmentId: { type: "string" }
      },
      required: ["appointmentId"],
      additionalProperties: false  // Required for strict mode
    }
  }
}];

// Anthropic strict mode
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  tools: pestCallTools,
  tool_choice: { type: "auto", disable_parallel_tool_use: false }
});
```

#### 3. Implement Proper Error Handling

```javascript
// Return informative errors to the model
async function executeToolCall(toolName, args, context) {
  try {
    const result = await toolHandlers[toolName](args, context);
    return { success: true, data: result };
  } catch (error) {
    // Let the model recover gracefully
    return {
      success: false,
      error: error.message,
      suggestion: getSuggestionForError(toolName, error)
    };
  }
}

function getSuggestionForError(toolName, error) {
  if (error.code === 'APPOINTMENT_NOT_FOUND') {
    return "The appointment ID was not found. Please call crm.listUpcomingAppointments to get valid IDs.";
  }
  if (error.code === 'NOT_VERIFIED') {
    return "Customer must be verified first. Call crm.verifyAccount with their ZIP code.";
  }
  return "Please try again or ask the customer for clarification.";
}
```

#### 4. Limit Tool Count

```javascript
// Use tool gating to reduce cognitive load on the model
function getAvailableTools(state) {
  const baseTool = [getServicePolicy];  // Always available

  if (!state.isVerified) {
    return [...baseTools, verifyAccount];  // Only verification
  }

  if (state.activeWorkflow === 'cancel') {
    return [...baseTools, listAppointments, cancelAppointment];
  }

  // Full toolset only when needed
  return [...baseTools, ...allCrmTools];
}
```

---

## Required Fixes for Current Implementation

Before migrating to LiveKit + Claude, the following fixes should be applied to the existing codebase to establish correct patterns:

### Fix 1: Proper Tool Result Threading (Priority: CRITICAL)

Refactor `runAgentLoopWithAdapter()` to maintain proper Anthropic message format:

```typescript
// Correct agent loop structure
private async runAgentLoopWithAdapter(input, turn, streamId): Promise<string> {
  // Build initial messages array with conversation history
  const messages: ClaudeMessage[] = [
    { role: "system", content: systemPrompt },
    ...this.messageHistory.map(m => ({ role: m.role, content: m.content }))
  ];

  while (iterations < maxIterations) {
    const response = await this.callClaude(messages, tools);

    // CRITICAL: Add assistant's response (including tool_use blocks) to messages
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      return extractText(response);
    }

    if (response.stop_reason === "tool_use") {
      const toolResults: ToolResultBlock[] = [];

      for (const toolUse of extractToolUses(response)) {
        const result = await this.executeToolCall(toolUse);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,  // CRITICAL: Must match tool_use.id
          content: JSON.stringify(result),
          is_error: result.error ? true : undefined
        });
      }

      // CRITICAL: Add tool results as user message
      messages.push({ role: "user", content: toolResults });
    }
  }
}
```

### Fix 2: Track Tool Use IDs in Types (Priority: HIGH)

Update `types.ts` to include tool use IDs:

```typescript
export const agentToolCallSchema = z.object({
  type: z.literal("tool_call"),
  toolUseId: z.string(),  // ADD THIS
  toolName: agentToolNameSchema,
  arguments: z.record(z.unknown()).optional(),
  acknowledgement: z.string().optional(),
});

export const agentToolCallsSchema = z.object({
  type: z.literal("tool_calls"),
  calls: z.array(
    z.object({
      toolUseId: z.string(),  // ADD THIS
      toolName: agentToolNameSchema,
      arguments: z.record(z.unknown()).optional(),
    }),
  ),
  acknowledgement: z.string().optional(),
});
```

Update `anthropic.ts` to preserve IDs:

```typescript
const validated = agentToolCallSchema.safeParse({
  type: "tool_call",
  toolUseId: toolUse.id,  // ADD THIS
  toolName: toolUse.name,
  arguments: toolUse.input,
  acknowledgement: responseText ?? undefined,
});
```

### Fix 3: Parallel Tool Execution (Priority: MEDIUM)

```typescript
if (output.type === "tool_calls") {
  const results = await Promise.all(
    output.calls.map(async (call) => {
      const executor = toolExecutors.get(call.toolName);
      if (!executor) {
        return {
          toolUseId: call.toolUseId,
          toolName: call.toolName,
          result: JSON.stringify({ error: `Unknown tool: ${call.toolName}` }),
          isError: true
        };
      }
      try {
        const result = await executor.execute(call.arguments ?? {});
        return { toolUseId: call.toolUseId, toolName: call.toolName, result, isError: false };
      } catch (error) {
        return {
          toolUseId: call.toolUseId,
          toolName: call.toolName,
          result: JSON.stringify({ error: error.message }),
          isError: true
        };
      }
    })
  );

  // Build tool_result messages
  const toolResultContent = results.map(r => ({
    type: "tool_result",
    tool_use_id: r.toolUseId,
    content: typeof r.result === 'string' ? r.result : JSON.stringify(r.result),
    is_error: r.isError || undefined
  }));

  messages.push({ role: "user", content: toolResultContent });
}
```

### Fix 4: Refresh State Each Iteration (Priority: MEDIUM)

```typescript
while (iterations < maxIterations) {
  // Refresh state each iteration to see tool updates
  const currentState = this.state.get();
  const tools = this.toolProvider.getTools(currentState);

  // Rebuild tool executors if tools changed
  if (toolsChanged(previousTools, tools)) {
    rebuildToolExecutors(tools);
  }

  // ... rest of loop
}
```

### Fix 5: Increase Max Iterations (Priority: LOW)

```typescript
// In defaultSessionConfig
maxToolRuns: 8,  // Increased from 5 to handle: lookup → verify → list → select → confirm → execute
```

---

## Deployment Strategy

### Recommended: Cloudflare AI Gateway + External LLMs

```
┌─────────────────────────────────────────────────────────────────┐
│                    Deployment Architecture                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                 Cloudflare AI Gateway                    │  │
│  │                                                          │  │
│  │  Features:                                               │  │
│  │  • Multi-provider routing (Claude, GPT-4, fallbacks)    │  │
│  │  • Response caching (90% latency reduction for repeats) │  │
│  │  • Rate limiting per user/tier                          │  │
│  │  • Cost tracking and analytics                          │  │
│  │  • Guardrails (content moderation)                      │  │
│  │  • Request retries with backoff                         │  │
│  │                                                          │  │
│  └────────────────────────┬─────────────────────────────────┘  │
│                           │                                     │
│          ┌────────────────┼────────────────┐                   │
│          ▼                ▼                ▼                   │
│    ┌──────────┐    ┌──────────┐    ┌──────────┐               │
│    │ Anthropic│    │  OpenAI  │    │ Workers  │               │
│    │  Claude  │    │  GPT-4   │    │   AI     │               │
│    │ (Primary)│    │(Fallback)│    │ (Edge)   │               │
│    └──────────┘    └──────────┘    └──────────┘               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### AI Gateway Configuration

```javascript
// wrangler.toml
// [ai]
// binding = "AI"

// Worker code using AI Gateway
export default {
  async fetch(request, env) {
    // Route through AI Gateway to Claude
    const response = await fetch(
      `https://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/${env.GATEWAY_ID}/anthropic/v1/messages`,
      {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
          // AI Gateway specific headers
          "cf-aig-cache-ttl": "3600",  // Cache for 1 hour
          "cf-aig-skip-cache": "false"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          tools: pestCallTools,
          messages: conversationMessages
        })
      }
    );

    return response;
  }
};
```

### Fallback Configuration

```javascript
// Dynamic routing with fallbacks
const routingConfig = {
  primary: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514"
  },
  fallbacks: [
    {
      provider: "openai",
      model: "gpt-4o",
      condition: "primary_failed"
    },
    {
      provider: "workers-ai",
      model: "@cf/meta/llama-3.1-70b-instruct",
      condition: "all_external_failed"
    }
  ],
  retries: {
    maxAttempts: 3,
    backoff: "exponential",
    initialDelayMs: 1000
  }
};
```

---

## Implementation Roadmap

### Phase 1: LLM Upgrade (Week 1-2)

**Goal:** Improve function calling reliability without changing architecture

**Tasks:**
1. Set up Cloudflare AI Gateway
2. Configure Claude Sonnet 4 as primary provider
3. Add GPT-4o as fallback
4. Update tool definitions with strict mode
5. Simplify prompts (model is smarter)
6. Run evaluation suite, compare results

**Expected Outcome:** 60%+ improvement in function calling accuracy

### Phase 2: Voice Pipeline (Week 3-6)

**Goal:** Add true real-time voice support

**Option A: OpenAI Realtime (Faster)**
1. Integrate OpenAI Realtime API
2. Set up Twilio SIP integration
3. Migrate tool definitions to Realtime format
4. Handle interruptions (barge-in)
5. Test with real phone calls

**Option B: LiveKit (More Flexible)**
1. Deploy LiveKit agents infrastructure
2. Integrate Deepgram STT + Cartesia TTS
3. Connect to Claude/GPT-4 via AI Gateway
4. Implement semantic turn detection
5. Add telephony via LiveKit or Twilio

**Expected Outcome:** <500ms voice response latency

### Phase 3: Enhanced Features (Week 7-10)

**Tasks:**
1. Integrate RAG with Vectorize for company knowledge
2. Add LangSmith for observability and evaluation
3. Implement conversation analytics
4. Add sentiment detection for escalation
5. Build human handoff flow
6. Production hardening

### Phase 4: Scale & Optimize (Week 11-12)

**Tasks:**
1. Load testing and performance optimization
2. Cost optimization (caching, model routing)
3. Multi-region deployment
4. Monitoring and alerting
5. Documentation and training

---

## Cost Analysis

### Current Estimated Costs (10,000 minutes/month)

| Component | Provider | Cost |
|-----------|----------|------|
| Workers AI (Hermes 7B) | Cloudflare | ~$50 |
| Durable Objects | Cloudflare | ~$20 |
| D1 Database | Cloudflare | ~$10 |
| **Total** | | **~$80/month** |

### Recommended Architecture Costs

#### Option A: OpenAI Realtime (Simple)

| Component | Provider | Cost |
|-----------|----------|------|
| OpenAI Realtime | OpenAI | ~$1,000 ($0.10/min) |
| Cloudflare Workers | Cloudflare | ~$30 |
| AI Gateway | Cloudflare | Free |
| **Total** | | **~$1,030/month** |

#### Option B: LiveKit + Claude (Optimized)

| Component | Provider | Cost |
|-----------|----------|------|
| LiveKit Cloud | LiveKit | ~$100 ($0.01/min) |
| Deepgram STT | Deepgram | ~$47 ($0.0047/min) |
| Claude Sonnet 4 | Anthropic | ~$300 (estimated) |
| Cartesia TTS | Cartesia | ~$200 ($0.02/min) |
| Cloudflare | Cloudflare | ~$50 |
| **Total** | | **~$700/month** |

#### Option C: High-Volume Optimized (50,000+ minutes)

| Component | Provider | Cost |
|-----------|----------|------|
| Self-hosted LiveKit | Self | ~$200 |
| Deepgram Enterprise | Deepgram | ~$235 |
| GPT-4o-mini | OpenAI | ~$150 |
| Deepgram Aura TTS | Deepgram | ~$540 |
| Cloudflare | Cloudflare | ~$100 |
| **Total** | | **~$1,225/month** |
| **Per minute** | | **~$0.025** |

### ROI Comparison

| Metric | Human Agent | AI Agent (Recommended) |
|--------|-------------|------------------------|
| Cost per minute | $0.30-0.50 | $0.07-0.10 |
| Availability | 8-12 hours | 24/7 |
| Consistency | Variable | High |
| Scale | Linear cost | Sublinear cost |
| Resolution rate | 100% | 70-85% |

**Break-even:** AI handles 70%+ of calls = 50-70% cost reduction

---

## Production Readiness

### Monitoring and Observability

#### Key Metrics to Track

| Metric | Target | Alert Threshold | Tool |
|--------|--------|-----------------|------|
| **End-to-End Latency** | <500ms | >800ms | LangSmith, Datadog |
| **Function Call Success Rate** | >95% | <90% | AI Gateway Analytics |
| **STT Accuracy (WER)** | <10% | >15% | Deepgram Dashboard |
| **Customer Satisfaction** | >4.0/5.0 | <3.5 | Post-call Survey |
| **Resolution Rate** | >75% | <60% | Custom Analytics |
| **Escalation Rate** | <25% | >35% | Durable Objects Logs |

#### LangSmith Integration

```javascript
// Enable tracing for all LLM calls
import { Client } from "langsmith";

const langsmith = new Client({
  apiKey: process.env.LANGSMITH_API_KEY
});

// Wrap LLM calls with tracing
async function tracedLLMCall(messages, tools, metadata) {
  const run = await langsmith.createRun({
    name: "pestcall-conversation",
    run_type: "chain",
    inputs: { messages, tools },
    extra: metadata
  });

  try {
    const response = await callLLM(messages, tools);
    await langsmith.updateRun(run.id, {
      outputs: response,
      end_time: new Date()
    });
    return response;
  } catch (error) {
    await langsmith.updateRun(run.id, {
      error: error.message,
      end_time: new Date()
    });
    throw error;
  }
}
```

#### Dashboard Metrics

Track these in your monitoring dashboard:
- Conversations per hour/day
- Average conversation duration
- Tool calls per conversation
- Provider latency (P50, P95, P99)
- Cache hit rate (AI Gateway)
- Error rate by type (LLM, STT, TTS, Tool)

### Security and Compliance

#### PII Handling

```javascript
// Scrub PII from logs and analytics
const PII_PATTERNS = {
  phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  creditCard: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g
};

function scrubPII(text) {
  let scrubbed = text;
  for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
    scrubbed = scrubbed.replace(pattern, `[REDACTED_${type.toUpperCase()}]`);
  }
  return scrubbed;
}

// Apply to all logging
function logConversation(sessionId, messages) {
  const scrubbedMessages = messages.map(m => ({
    ...m,
    content: scrubPII(m.content)
  }));
  logger.info({ sessionId, messages: scrubbedMessages });
}
```

#### Compliance Checklist

| Requirement | Implementation | Status |
|-------------|----------------|--------|
| **TCPA Consent** | Record consent before AI interaction | Required |
| **Call Recording Disclosure** | "This call may be recorded" | Required |
| **Two-Party Consent States** | Check caller state, get explicit consent | Required for CA, FL, etc. |
| **GDPR (if applicable)** | Data retention policy, right to deletion | If serving EU |
| **CCPA** | Disclose data collection, opt-out | If serving CA |
| **PCI-DSS** | Never store/transmit card numbers via AI | Required |

#### Data Retention Policy

```javascript
// Automatic data cleanup
const RETENTION_POLICIES = {
  conversationHistory: 90,  // days
  audioRecordings: 30,      // days (if stored)
  analyticsData: 365,       // days
  piiData: 0                // Never store raw PII
};

// Scheduled cleanup job
async function cleanupExpiredData() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_POLICIES.conversationHistory);

  await db.conversations.deleteMany({
    createdAt: { $lt: cutoffDate }
  });
}
```

### Human Handoff Strategy

#### Escalation Triggers

```javascript
const ESCALATION_TRIGGERS = {
  // Explicit requests
  explicit: [
    /speak to (a |an )?(human|agent|person|representative|manager)/i,
    /transfer me/i,
    /real person/i
  ],

  // Sentiment-based
  sentiment: {
    threshold: -0.5,  // Negative sentiment score
    consecutiveNegative: 2  // Messages in a row
  },

  // Conversation-based
  conversation: {
    maxTurns: 10,           // Too many back-and-forth
    repeatedIntents: 3,      // Same intent repeated
    toolFailures: 2          // Consecutive tool failures
  },

  // Topic-based
  topics: [
    'legal', 'lawsuit', 'attorney',
    'complaint', 'bbb', 'report',
    'refund over $500', 'damage claim'
  ]
};

async function checkEscalation(state, latestMessage) {
  // Check explicit requests
  for (const pattern of ESCALATION_TRIGGERS.explicit) {
    if (pattern.test(latestMessage)) {
      return { escalate: true, reason: 'customer_request' };
    }
  }

  // Check sentiment
  const sentiment = await analyzeSentiment(latestMessage);
  if (sentiment.score < ESCALATION_TRIGGERS.sentiment.threshold) {
    state.negativeCount = (state.negativeCount || 0) + 1;
    if (state.negativeCount >= ESCALATION_TRIGGERS.sentiment.consecutiveNegative) {
      return { escalate: true, reason: 'negative_sentiment' };
    }
  }

  // Check turn count
  if (state.turnCount > ESCALATION_TRIGGERS.conversation.maxTurns) {
    return { escalate: true, reason: 'conversation_length' };
  }

  return { escalate: false };
}
```

#### Warm Transfer Flow

```
Warm Transfer Sequence:
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  1. AI detects escalation trigger                               │
│     ↓                                                           │
│  2. AI: "I'll connect you with a specialist who can help."     │
│     ↓                                                           │
│  3. Generate conversation summary for human agent               │
│     ↓                                                           │
│  4. Queue call with priority based on sentiment/topic           │
│     ↓                                                           │
│  5. Play hold music / provide wait time estimate                │
│     ↓                                                           │
│  6. Human agent receives: summary, customer info, history       │
│     ↓                                                           │
│  7. Seamless handoff with context preserved                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```javascript
async function initiateWarmTransfer(sessionState) {
  // Generate summary for human agent
  const summary = await generateConversationSummary(sessionState.history);

  // Create transfer ticket
  const ticket = await createEscalationTicket({
    customerId: sessionState.customerId,
    customerName: sessionState.customerName,
    phone: sessionState.phoneNumber,
    summary,
    sentiment: sessionState.lastSentiment,
    reason: sessionState.escalationReason,
    conversationHistory: sessionState.history.slice(-10),
    priority: calculatePriority(sessionState)
  });

  // Notify human agent queue
  await agentQueue.enqueue(ticket);

  // Return message for customer
  return {
    message: `I'm connecting you with a specialist now. Your wait time is approximately ${ticket.estimatedWait} minutes. They'll have all the details of our conversation.`,
    holdMusic: true,
    ticketId: ticket.id
  };
}
```

---

## Risk Mitigation

### Single Points of Failure

| Risk | Impact | Mitigation |
|------|--------|------------|
| **OpenAI API outage** | Complete service loss | AI Gateway fallback to Claude/Workers AI |
| **Cloudflare outage** | Complete service loss | Multi-cloud backup (AWS Lambda) |
| **Deepgram STT failure** | No voice input | AssemblyAI fallback |
| **TTS provider failure** | No voice output | Multiple TTS providers configured |
| **Database corruption** | Lost conversation state | Regular backups, multi-region D1 |

### Circuit Breaker Pattern

```javascript
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 30000;
    this.state = 'CLOSED';
    this.failures = 0;
    this.lastFailureTime = null;
  }

  async execute(fn, fallback) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        return fallback();
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      if (this.state === 'OPEN') {
        return fallback();
      }
      throw error;
    }
  }

  onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }
}

// Usage with LLM providers
const claudeBreaker = new CircuitBreaker({ failureThreshold: 3 });
const openaiBreaker = new CircuitBreaker({ failureThreshold: 3 });

async function callLLMWithFallback(messages, tools) {
  return claudeBreaker.execute(
    () => callClaude(messages, tools),
    () => openaiBreaker.execute(
      () => callOpenAI(messages, tools),
      () => callWorkersAI(messages, tools)  // Final fallback
    )
  );
}
```

### Graceful Degradation

```javascript
const DEGRADATION_LEVELS = {
  FULL: {
    llm: 'claude-sonnet-4',
    stt: 'deepgram-nova-3',
    tts: 'elevenlabs',
    features: ['rag', 'sentiment', 'analytics']
  },
  REDUCED: {
    llm: 'gpt-4o-mini',
    stt: 'deepgram-nova-2',
    tts: 'deepgram-aura',
    features: ['analytics']
  },
  MINIMAL: {
    llm: 'workers-ai-llama',
    stt: 'whisper',
    tts: 'basic',
    features: []
  },
  EMERGENCY: {
    // Direct to human agents
    message: "We're experiencing technical difficulties. Connecting you to an agent.",
    directTransfer: true
  }
};

async function getCurrentDegradationLevel() {
  const health = await checkAllProviders();

  if (health.claude && health.deepgram && health.elevenlabs) {
    return DEGRADATION_LEVELS.FULL;
  }
  if (health.openai || health.workersAI) {
    return DEGRADATION_LEVELS.REDUCED;
  }
  if (health.workersAI) {
    return DEGRADATION_LEVELS.MINIMAL;
  }
  return DEGRADATION_LEVELS.EMERGENCY;
}
```

### Load Testing Plan

| Test | Target | Duration | Tools |
|------|--------|----------|-------|
| **Baseline** | 100 concurrent calls | 1 hour | k6, Artillery |
| **Peak Load** | 500 concurrent calls | 30 min | k6 |
| **Sustained** | 200 concurrent, 10K total | 8 hours | k6 |
| **Spike** | 0→1000→0 over 5 min | 15 min | Artillery |
| **Soak** | 100 concurrent | 24 hours | k6 |

```javascript
// k6 load test script
import http from 'k6/http';
import { check, sleep } from 'k6';
import { WebSocket } from 'k6/experimental/websockets';

export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp up
    { duration: '5m', target: 100 },   // Sustain
    { duration: '2m', target: 200 },   // Push higher
    { duration: '5m', target: 200 },   // Sustain peak
    { duration: '2m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% under 500ms
    http_req_failed: ['rate<0.01'],    // <1% errors
  },
};

export default function () {
  const sessionId = `load-test-${__VU}-${__ITER}`;

  // Simulate conversation
  const messages = [
    "Hi, I'd like to cancel my appointment",
    "98109",
    "Yes, please cancel the first one"
  ];

  for (const message of messages) {
    const res = http.post(
      `${BASE_URL}/api/conversations/${sessionId}/message`,
      JSON.stringify({ text: message }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    check(res, {
      'status is 200': (r) => r.status === 200,
      'response time < 500ms': (r) => r.timings.duration < 500,
    });

    sleep(2);  // Realistic pause between messages
  }
}
```

---

## Appendix: Code Examples

### A. Claude Tool Calling with Strict Mode

```javascript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}/anthropic`
});

const pestCallTools = [
  {
    name: "crm.verifyAccount",
    description: "Verify customer account using ZIP code. Call when customer provides 5-digit ZIP.",
    input_schema: {
      type: "object",
      properties: {
        zipCode: {
          type: "string",
          pattern: "^\\d{5}$",
          description: "Customer's 5-digit ZIP code"
        }
      },
      required: ["zipCode"]
    }
  },
  {
    name: "crm.listUpcomingAppointments",
    description: "List customer's upcoming appointments. Call after verification to see scheduled services.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Max appointments to return",
          default: 5
        }
      }
    }
  },
  {
    name: "crm.cancelAppointment",
    description: "Cancel an appointment. Only call after customer confirms cancellation.",
    input_schema: {
      type: "object",
      properties: {
        appointmentId: {
          type: "string",
          description: "ID from crm.listUpcomingAppointments (e.g., 'appt_001')"
        }
      },
      required: ["appointmentId"]
    }
  }
];

async function processMessage(conversationHistory, userMessage) {
  const messages = [
    ...conversationHistory,
    { role: "user", content: userMessage }
  ];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `You are a friendly PestCall customer service agent.
             Verify customers before accessing their account.
             Be concise and conversational - this is a phone call.`,
    tools: pestCallTools,
    messages
  });

  // Handle tool calls
  if (response.stop_reason === "tool_use") {
    const toolUse = response.content.find(c => c.type === "tool_use");
    const toolResult = await executeToolCall(toolUse.name, toolUse.input);

    // Continue conversation with tool result
    return processMessage([
      ...messages,
      { role: "assistant", content: response.content },
      { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(toolResult) }] }
    ], "");
  }

  return response.content[0].text;
}
```

### B. LiveKit Voice Agent

```python
from livekit.agents import Agent, AgentSession, JobContext, function_tool
from livekit.plugins import silero, deepgram, cartesia
from livekit.plugins.openai import LLM
import os

# Define tools
@function_tool
async def verify_account(zip_code: str) -> dict:
    """Verify customer account using their ZIP code."""
    # Your CRM integration
    result = await crm_client.verify(zip_code)
    return {"verified": result.success, "customer_name": result.name}

@function_tool
async def list_appointments(limit: int = 5) -> dict:
    """List customer's upcoming pest control appointments."""
    appointments = await crm_client.get_appointments(limit=limit)
    return {"appointments": [a.to_dict() for a in appointments]}

@function_tool
async def cancel_appointment(appointment_id: str) -> dict:
    """Cancel a scheduled appointment after customer confirmation."""
    result = await crm_client.cancel(appointment_id)
    return {"cancelled": result.success, "message": result.message}

async def entrypoint(ctx: JobContext):
    await ctx.connect()

    session = AgentSession(
        vad=silero.VAD.load(),
        stt=deepgram.STT(
            model="nova-3",
            api_key=os.environ["DEEPGRAM_API_KEY"]
        ),
        llm=LLM(
            model="gpt-4o",
            api_key=os.environ["OPENAI_API_KEY"],
            base_url=f"https://gateway.ai.cloudflare.com/v1/{ACCOUNT_ID}/{GATEWAY_ID}/openai"
        ),
        tts=cartesia.TTS(
            model="sonic-english",
            voice="customer-service-friendly",
            api_key=os.environ["CARTESIA_API_KEY"]
        ),
        chat_ctx=ChatContext(
            system_prompt="""You are a friendly PestCall customer service agent.
            Verify customers with their ZIP code before accessing account info.
            Be concise - this is a phone conversation."""
        ),
        allow_interruptions=True,
        interrupt_speech_duration=0.5
    )

    session.add_tool(verify_account)
    session.add_tool(list_appointments)
    session.add_tool(cancel_appointment)

    await session.start(ctx.room)

if __name__ == "__main__":
    from livekit.agents import cli
    cli.run_app(entrypoint)
```

### C. Cloudflare Durable Object with AI Gateway

```javascript
// Enhanced Durable Object session with AI Gateway
export class ConversationSessionV3 {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async processMessage(userMessage) {
    // Load state
    const history = await this.state.storage.get("history") || [];
    const domainState = await this.state.storage.get("domainState") || {};

    // Add user message
    history.push({ role: "user", content: userMessage });

    // Get available tools based on state
    const tools = this.getAvailableTools(domainState);

    // Call Claude via AI Gateway
    const response = await this.callLLM(history, tools, domainState);

    // Process tool calls if any
    if (response.tool_calls) {
      for (const toolCall of response.tool_calls) {
        const result = await this.executeToolCall(toolCall, domainState);
        history.push({
          role: "assistant",
          content: [{ type: "tool_use", ...toolCall }]
        });
        history.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: toolCall.id, content: JSON.stringify(result) }]
        });

        // Update domain state based on tool results
        Object.assign(domainState, result.stateUpdates || {});
      }

      // Get final response after tool execution
      return this.processMessage("");
    }

    // Save state
    history.push({ role: "assistant", content: response.text });
    await this.state.storage.put("history", history.slice(-20));
    await this.state.storage.put("domainState", domainState);

    return response.text;
  }

  async callLLM(messages, tools, domainState) {
    const response = await fetch(
      `https://gateway.ai.cloudflare.com/v1/${this.env.ACCOUNT_ID}/${this.env.GATEWAY_ID}/anthropic/v1/messages`,
      {
        method: "POST",
        headers: {
          "x-api-key": this.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
          "cf-aig-cache-ttl": "300"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: this.buildSystemPrompt(domainState),
          tools,
          messages
        })
      }
    );

    const data = await response.json();

    // Parse response
    const toolCalls = data.content.filter(c => c.type === "tool_use");
    const textContent = data.content.find(c => c.type === "text");

    return {
      tool_calls: toolCalls.length > 0 ? toolCalls : null,
      text: textContent?.text || ""
    };
  }

  getAvailableTools(state) {
    if (!state.isVerified) {
      return [verifyAccountTool, getServicePolicyTool];
    }
    return [
      listAppointmentsTool,
      cancelAppointmentTool,
      rescheduleAppointmentTool,
      getServicePolicyTool,
      escalateTool
    ];
  }

  buildSystemPrompt(state) {
    if (!state.isVerified) {
      return `You are a friendly PestCall customer service agent.
        Ask for the customer's ZIP code to verify their account.
        Be warm and conversational - this is a phone call.`;
    }
    return `You are a helpful PestCall customer service agent.
      Customer: ${state.customerName} (verified)
      Help them with appointments, billing, or service questions.
      Be concise and natural - this is a phone conversation.`;
  }
}
```

---

## Evaluation Strategy

### Overview

Evaluating LLM-based chatbots requires measuring both functional correctness (did it call the right tools?) and conversational quality (was the response helpful?). For voice agents, latency metrics become equally critical.

### Recommended Evaluation Stack

| Component | Tool | Purpose |
|-----------|------|---------|
| **Tracing & Logging** | Langfuse or LangSmith | Capture all LLM calls, tool invocations, latencies |
| **Automated Testing** | Promptfoo | CI/CD integration, regression testing |
| **LLM-as-Judge** | Claude/GPT-4 | Automated quality assessment |
| **Human Evaluation** | Custom dashboard | Ground truth, edge cases |
| **A/B Testing** | Statsig or custom | Compare model versions |

### Core Metrics

#### Function Calling Accuracy

| Metric | Definition | Target |
|--------|------------|--------|
| **Tool Selection Accuracy** | Correct tool called / Total tool calls | >95% |
| **Argument Correctness** | Valid arguments / Total tool calls | >98% |
| **Tool Sequence Correctness** | Correct multi-step flows / Total multi-step flows | >90% |
| **Hallucination Rate** | Invented IDs/data / Total tool calls | <2% |

```typescript
// Evaluation schema for function calling
interface ToolCallEval {
  scenario: string;
  userInput: string;
  expectedTool: string;
  expectedArgs: Record<string, unknown>;
  actualTool: string;
  actualArgs: Record<string, unknown>;
  toolSelectionCorrect: boolean;
  argsCorrect: boolean;
  latencyMs: number;
}
```

#### Conversation Quality Metrics

| Metric | Definition | Measurement |
|--------|------------|-------------|
| **Task Completion Rate** | Successfully resolved conversations | Human labeling + heuristics |
| **Turn Efficiency** | Avg turns to resolution | Automated counting |
| **Coherence Score** | Response relevance and consistency | LLM-as-judge |
| **Helpfulness Score** | User perception of helpfulness | Post-call survey + LLM-as-judge |
| **Safety Score** | Absence of harmful/inappropriate content | Automated classifiers |

#### Voice-Specific Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| **Time to First Audio (TTFA)** | <400ms | >600ms |
| **End-to-End Latency (P50)** | <500ms | >800ms |
| **End-to-End Latency (P95)** | <800ms | >1200ms |
| **Interruption Success Rate** | >95% | <85% |
| **STT Word Error Rate** | <10% | >15% |
| **Acknowledgement Latency** | <150ms | >300ms |

### LLM-as-Judge Implementation

Use Claude or GPT-4 to automatically evaluate conversation quality:

```typescript
const JUDGE_PROMPT = `You are evaluating a customer service conversation.

<conversation>
{{conversation}}
</conversation>

<evaluation_criteria>
1. Task Completion (0-10): Did the agent successfully help the customer?
2. Efficiency (0-10): Was the conversation concise without unnecessary back-and-forth?
3. Accuracy (0-10): Were all facts and tool results correctly communicated?
4. Tone (0-10): Was the agent friendly, professional, and appropriate?
5. Safety (0-10): Did the agent avoid any harmful or inappropriate content?
</evaluation_criteria>

Provide your evaluation as JSON:
{
  "task_completion": { "score": number, "reasoning": string },
  "efficiency": { "score": number, "reasoning": string },
  "accuracy": { "score": number, "reasoning": string },
  "tone": { "score": number, "reasoning": string },
  "safety": { "score": number, "reasoning": string },
  "overall": { "score": number, "summary": string },
  "issues": string[]
}`;

async function evaluateConversation(messages: Message[]): Promise<EvalResult> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: JUDGE_PROMPT.replace("{{conversation}}", formatConversation(messages))
    }]
  });

  return JSON.parse(extractJSON(response.content[0].text));
}
```

### CI/CD Integration with Promptfoo

```yaml
# promptfoo.yaml
providers:
  - id: anthropic:messages:claude-sonnet-4-20250514
    config:
      tools: file://tools/pestcall-tools.json

prompts:
  - file://prompts/system-prompt.txt

tests:
  # Tool Selection Tests
  - description: "Should verify account with ZIP code"
    vars:
      user_message: "My ZIP is 98109"
    assert:
      - type: is-json
      - type: javascript
        value: output.tool_calls?.[0]?.name === "crm.verifyAccount"
      - type: javascript
        value: output.tool_calls?.[0]?.arguments?.zipCode === "98109"

  - description: "Should NOT call cancel without verification"
    vars:
      user_message: "Cancel my appointment"
    assert:
      - type: not-contains
        value: "crm.cancelAppointment"

  - description: "Should list appointments before cancelling"
    vars:
      user_message: "I want to cancel"
      context: "Customer is verified"
    assert:
      - type: javascript
        value: output.tool_calls?.[0]?.name === "crm.listUpcomingAppointments"

  # Conversation Quality Tests
  - description: "Greeting should be friendly"
    vars:
      user_message: "Hi"
    assert:
      - type: llm-rubric
        value: "Response is warm, friendly, and offers help"

  - description: "Should handle ambiguity gracefully"
    vars:
      user_message: "I need help with my thing"
    assert:
      - type: llm-rubric
        value: "Response asks clarifying questions politely"

  # Regression Tests
  - description: "Should NOT hallucinate appointment IDs"
    vars:
      user_message: "Cancel appointment 12345"
      context: "No appointments listed yet"
    assert:
      - type: not-contains
        value: "12345"
      - type: llm-rubric
        value: "Agent asks to look up appointments first, does not use made-up ID"
```

```bash
# Run in CI
npx promptfoo eval --config promptfoo.yaml --output results.json

# Check pass rate
PASS_RATE=$(jq '.results.stats.passRate' results.json)
if (( $(echo "$PASS_RATE < 0.95" | bc -l) )); then
  echo "Evaluation pass rate $PASS_RATE below threshold 0.95"
  exit 1
fi
```

### Synthetic Data Generation

Generate diverse test scenarios automatically:

```typescript
const SCENARIO_GENERATOR_PROMPT = `Generate 10 diverse customer service scenarios for a pest control company.

Each scenario should include:
- customer_type: "new" | "existing" | "frustrated" | "confused"
- intent: "cancel" | "reschedule" | "billing" | "general"
- complexity: "simple" | "medium" | "complex"
- user_messages: array of realistic customer messages
- expected_tools: array of tools that should be called
- expected_outcome: description of successful resolution

Output as JSON array.`;

async function generateTestScenarios(): Promise<Scenario[]> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: SCENARIO_GENERATOR_PROMPT }]
  });

  return JSON.parse(extractJSON(response.content[0].text));
}
```

### Quality Gates

Define minimum thresholds for deployment:

```typescript
const QUALITY_GATES = {
  // Must pass to deploy to staging
  staging: {
    toolSelectionAccuracy: 0.90,
    argsCorrect: 0.95,
    llmJudgeScore: 7.0,
    regressionPassRate: 0.95,
  },

  // Must pass to deploy to production
  production: {
    toolSelectionAccuracy: 0.95,
    argsCorrect: 0.98,
    llmJudgeScore: 8.0,
    regressionPassRate: 0.99,
    p95Latency: 800, // ms
    humanEvalScore: 4.0, // out of 5
  }
};
```

---

## Acknowledgement Messages and Progressive Response

### Current Implementation Analysis

The existing codebase implements acknowledgements as early responses during tool execution. This is a good UX pattern but has implementation issues:

**Current Pattern:**
```typescript
// In session.ts
if (output.acknowledgement) {
  this.emit("acknowledgement", { text: output.acknowledgement });
}
// Then execute tool and send full response later
```

**Issues Identified:**

1. **Not Included in Evaluations**: Acknowledgements are sent via WebSocket only, bypassing the evaluation pipeline
2. **Inconsistent Timing**: Model generates acknowledgement with tool call; no control over when it appears
3. **No Fallback**: If acknowledgement is missing, user experiences silence
4. **Testing Gap**: WebSocket-only delivery means acknowledgements aren't captured in conversation logs

### Recommended Pattern: Progressive Response with Filler

The industry best practice for low-latency voice interactions is "progressive response" or "filler phrases":

```
User: "Can you cancel my appointment tomorrow?"
Agent: "Sure, let me look that up..." ← Immediate filler (< 200ms)
       [Tool executes in background]
Agent: "I found your appointment for tomorrow at 2 PM. Would you like me to cancel it?"
```

#### Implementation Strategy

**1. Pre-computed Filler Phrases (Fastest)**

Don't wait for the model to generate acknowledgements. Use pre-defined fillers based on detected intent:

```typescript
const FILLER_PHRASES: Record<string, string[]> = {
  lookup: [
    "Let me check that for you...",
    "One moment while I look that up...",
    "Sure, pulling that information now...",
  ],
  action: [
    "I'll take care of that right now...",
    "Processing that for you...",
    "Let me handle that...",
  ],
  thinking: [
    "Let me think about that...",
    "Good question, let me see...",
    "Hmm, let me check...",
  ],
  default: [
    "One moment...",
    "Just a second...",
    "Let me see...",
  ]
};

function getFillerPhrase(intent: string): string {
  const phrases = FILLER_PHRASES[intent] || FILLER_PHRASES.default;
  return phrases[Math.floor(Math.random() * phrases.length)];
}
```

**2. Intent-Based Filler Selection**

Detect intent early (before full LLM response) to select appropriate filler:

```typescript
class ProgressiveResponseHandler {
  private fillerTimeout: NodeJS.Timeout | null = null;
  private fillerSent = false;

  async handleMessage(userMessage: string): Promise<void> {
    // Start filler timer immediately (fires if LLM takes > 300ms)
    this.startFillerTimer(userMessage);

    try {
      // Call LLM
      const response = await this.callLLM(userMessage);

      // Cancel filler if LLM responded fast enough
      this.cancelFillerTimer();

      if (response.stop_reason === "tool_use") {
        // If we haven't sent filler yet and tool will take time, send now
        if (!this.fillerSent) {
          const filler = this.getFillerForTool(response.tool_calls[0].name);
          this.emitAcknowledgement(filler);
        }

        // Execute tool and continue
        const toolResult = await this.executeTool(response.tool_calls[0]);
        return this.handleToolResult(toolResult);
      }

      // Direct response - emit it
      this.emitResponse(response.text);

    } catch (error) {
      this.cancelFillerTimer();
      this.handleError(error);
    }
  }

  private startFillerTimer(userMessage: string): void {
    // Quick intent detection for filler selection
    const intent = this.quickIntentDetect(userMessage);

    this.fillerTimeout = setTimeout(() => {
      if (!this.fillerSent) {
        const filler = getFillerPhrase(intent);
        this.emitAcknowledgement(filler);
        this.fillerSent = true;
      }
    }, 300); // 300ms threshold
  }

  private quickIntentDetect(message: string): string {
    const lowerMessage = message.toLowerCase();

    if (/cancel|reschedule|change|move/.test(lowerMessage)) return "action";
    if (/check|look|find|when|what/.test(lowerMessage)) return "lookup";
    if (/how|why|explain/.test(lowerMessage)) return "thinking";
    return "default";
  }

  private getFillerForTool(toolName: string): string {
    const toolFillers: Record<string, string> = {
      "crm.listUpcomingAppointments": "Let me pull up your appointments...",
      "crm.cancelAppointment": "Processing that cancellation now...",
      "crm.rescheduleAppointment": "Finding available times for you...",
      "crm.getOpenInvoices": "Checking your account balance...",
      "crm.verifyAccount": "Verifying your account...",
    };
    return toolFillers[toolName] || "One moment...";
  }
}
```

**3. Pre-computed TTS for Fillers (Ultra-Low Latency)**

For voice, pre-generate TTS audio for common fillers:

```typescript
class PrecomputedFillerCache {
  private audioCache = new Map<string, ArrayBuffer>();

  async initialize(): Promise<void> {
    const allFillers = Object.values(FILLER_PHRASES).flat();

    // Pre-generate TTS for all filler phrases
    await Promise.all(
      allFillers.map(async (phrase) => {
        const audio = await this.ttsClient.synthesize(phrase);
        this.audioCache.set(phrase, audio);
      })
    );
  }

  getPrecomputedAudio(phrase: string): ArrayBuffer | null {
    return this.audioCache.get(phrase) || null;
  }
}

// Usage in voice pipeline
async function sendFiller(phrase: string): Promise<void> {
  const precomputed = fillerCache.getPrecomputedAudio(phrase);

  if (precomputed) {
    // Instant playback - no TTS latency
    await audioPlayer.play(precomputed);
  } else {
    // Fallback to live TTS
    const audio = await ttsClient.synthesize(phrase);
    await audioPlayer.play(audio);
  }
}
```

### Testing Acknowledgements

**Problem:** Acknowledgements bypass the standard conversation evaluation because they're WebSocket events.

**Solution:** Unified event logging that captures all outputs:

```typescript
interface ConversationEvent {
  type: "user_message" | "acknowledgement" | "assistant_message" | "tool_call" | "tool_result";
  timestamp: number;
  content: string | object;
  latencyMs?: number;
}

class UnifiedEventLogger {
  private events: ConversationEvent[] = [];
  private startTime: number;

  startConversation(): void {
    this.events = [];
    this.startTime = Date.now();
  }

  logEvent(type: ConversationEvent["type"], content: string | object): void {
    this.events.push({
      type,
      timestamp: Date.now(),
      content,
      latencyMs: Date.now() - this.startTime,
    });
  }

  getFullTranscript(): ConversationEvent[] {
    return this.events;
  }

  // For evaluation: convert to standard format including acknowledgements
  toEvalFormat(): EvalConversation {
    return {
      turns: this.events.map(e => ({
        role: e.type === "user_message" ? "user" : "assistant",
        content: typeof e.content === "string" ? e.content : JSON.stringify(e.content),
        metadata: {
          type: e.type,
          latencyMs: e.latencyMs,
          isAcknowledgement: e.type === "acknowledgement",
        }
      }))
    };
  }
}
```

**Acknowledgement-Specific Evaluations:**

```yaml
# promptfoo.yaml - acknowledgement tests
tests:
  - description: "Should send acknowledgement within 300ms for slow tools"
    vars:
      user_message: "Cancel my appointment"
      tool_latency: 2000  # Simulated 2s tool execution
    assert:
      - type: javascript
        value: |
          const ackEvent = output.events.find(e => e.type === "acknowledgement");
          return ackEvent && ackEvent.latencyMs < 300;

  - description: "Acknowledgement should be contextually appropriate"
    vars:
      user_message: "What's my balance?"
    assert:
      - type: javascript
        value: |
          const ack = output.events.find(e => e.type === "acknowledgement")?.content;
          return ack && /check|look|balance|account/i.test(ack);

  - description: "Should NOT send acknowledgement for fast responses"
    vars:
      user_message: "What are your hours?"
      response_latency: 150  # Simulated 150ms response
    assert:
      - type: javascript
        value: |
          const ackEvent = output.events.find(e => e.type === "acknowledgement");
          return !ackEvent;  // No acknowledgement needed for fast responses
```

---

## Barge-In (Interruption Handling)

### Current Implementation Issues

The existing barge-in implementation has these issues:

1. **Detection Latency**: VAD detection + processing adds 200-400ms before interruption is recognized
2. **Audio Queue Not Cleared**: Buffered audio continues playing briefly after interruption
3. **Context Loss**: Interrupted content not tracked, model doesn't know what user heard
4. **No Semantic Interruption**: System can't distinguish "uh huh" (continue) from "wait, stop" (interrupt)

### Best Practices for Barge-In

#### 1. Aggressive Audio Cancellation

```typescript
class AudioOutputManager {
  private audioQueue: ArrayBuffer[] = [];
  private currentPlayback: AudioContext | null = null;
  private streamId: string | null = null;

  async play(audio: ArrayBuffer, streamId: string): Promise<void> {
    this.streamId = streamId;
    this.audioQueue.push(audio);
    await this.processQueue();
  }

  cancelImmediate(): { cancelled: boolean; partialContent: string } {
    // 1. Stop current audio context immediately
    if (this.currentPlayback) {
      this.currentPlayback.close();
      this.currentPlayback = null;
    }

    // 2. Clear audio queue
    const cancelledChunks = this.audioQueue.length;
    this.audioQueue = [];

    // 3. Invalidate stream ID to reject any in-flight audio
    const oldStreamId = this.streamId;
    this.streamId = null;

    return {
      cancelled: cancelledChunks > 0,
      partialContent: this.getSpokenContent(), // Track what was actually spoken
    };
  }

  // Track what content was actually spoken (for context preservation)
  private spokenWords: string[] = [];

  getSpokenContent(): string {
    return this.spokenWords.join(" ");
  }
}
```

#### 2. VAD Sensitivity Tuning

```typescript
// LiveKit/Silero VAD configuration for responsive interruption
const vadConfig = {
  // Lower threshold = more sensitive to interruptions
  activationThreshold: 0.3,  // Default is 0.5

  // Shorter speech duration required to trigger
  minSpeechDuration: 150,    // ms (default 250)

  // How quickly to confirm end of speech
  maxSilenceDuration: 300,   // ms

  // Padding to avoid cutting off speech
  paddingDuration: 100,      // ms
};

// For Deepgram streaming STT
const deepgramConfig = {
  // Endpointing controls when STT considers speech "done"
  endpointing: 200,          // ms (lower = faster interruption detection)

  // Interim results for early interruption detection
  interim_results: true,

  // Voice activity detection built-in
  vad_events: true,
};
```

#### 3. Semantic Interruption Detection

Distinguish between different types of user input during agent speech:

```typescript
enum InterruptionType {
  HARD_STOP = "hard_stop",      // "Wait", "Stop", "Hold on"
  CORRECTION = "correction",     // "No, I meant...", "Actually..."
  BACKCHANNEL = "backchannel",  // "Uh huh", "Right", "Okay"
  QUESTION = "question",         // "What?", "Huh?"
  CONTINUATION = "continuation", // Unrelated new input
}

const INTERRUPTION_PATTERNS: Record<InterruptionType, RegExp[]> = {
  [InterruptionType.HARD_STOP]: [
    /^(wait|stop|hold on|hang on|one (second|moment)|pause)/i,
  ],
  [InterruptionType.CORRECTION]: [
    /^(no|actually|i meant|not that|wrong)/i,
  ],
  [InterruptionType.BACKCHANNEL]: [
    /^(uh huh|mm hmm|right|okay|ok|yes|yeah|got it|i see)$/i,
  ],
  [InterruptionType.QUESTION]: [
    /^(what|huh|sorry|pardon|excuse me)\??$/i,
  ],
};

function classifyInterruption(text: string): InterruptionType {
  const trimmed = text.trim();

  for (const [type, patterns] of Object.entries(INTERRUPTION_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        return type as InterruptionType;
      }
    }
  }

  return InterruptionType.CONTINUATION;
}

async function handleInterruption(
  interruptionText: string,
  spokenContent: string
): Promise<InterruptionAction> {
  const type = classifyInterruption(interruptionText);

  switch (type) {
    case InterruptionType.BACKCHANNEL:
      // Don't stop, just note the acknowledgement
      return { action: "continue", addToContext: false };

    case InterruptionType.HARD_STOP:
      // Stop and wait for next input
      return { action: "stop_and_wait", addToContext: true };

    case InterruptionType.CORRECTION:
      // Stop and process the correction
      return {
        action: "stop_and_process",
        addToContext: true,
        contextNote: `[User interrupted after hearing: "${spokenContent}"]`
      };

    case InterruptionType.QUESTION:
      // Repeat or clarify what was said
      return {
        action: "clarify",
        response: `I was saying: ${spokenContent}. Would you like me to continue?`
      };

    default:
      // Treat as new input
      return { action: "stop_and_process", addToContext: true };
  }
}
```

#### 4. Context Preservation on Interruption

Track what the user actually heard for better conversation flow:

```typescript
interface InterruptionContext {
  intendedResponse: string;      // Full response model generated
  spokenPortion: string;         // What was actually spoken before interruption
  interruptionText: string;      // What user said to interrupt
  timestamp: number;
}

class InterruptionAwareSession {
  private lastInterruption: InterruptionContext | null = null;

  async handleInterruption(
    interruptionText: string,
    spokenPortion: string,
    intendedResponse: string
  ): Promise<void> {
    this.lastInterruption = {
      intendedResponse,
      spokenPortion,
      interruptionText,
      timestamp: Date.now(),
    };

    // Add context to message history so model knows what happened
    this.addSystemContext(
      `[Interruption: Agent was saying "${spokenPortion}" when user interrupted with "${interruptionText}". ` +
      `The agent had intended to say: "${intendedResponse}"]`
    );
  }

  // For model context: let it know about recent interruption
  buildSystemContext(): string {
    if (this.lastInterruption && Date.now() - this.lastInterruption.timestamp < 30000) {
      return `\n\nRecent interruption: User cut off your previous response. ` +
             `They heard: "${this.lastInterruption.spokenPortion}" before interrupting.`;
    }
    return "";
  }
}
```

#### 5. Testing Barge-In

```typescript
// Simulated barge-in test scenarios
const BARGE_IN_TESTS = [
  {
    name: "Hard stop mid-sentence",
    agentResponse: "Your appointment is scheduled for tomorrow at 2 PM. The technician will...",
    interruptAt: "tomorrow at 2 PM",
    userInterruption: "Wait, what time?",
    expectedBehavior: "stop_and_clarify",
    expectedLatencyMs: 200,
  },
  {
    name: "Backchannel should not interrupt",
    agentResponse: "I can help you reschedule that. Let me check available times...",
    interruptAt: "reschedule that",
    userInterruption: "Okay",
    expectedBehavior: "continue_speaking",
  },
  {
    name: "Correction mid-flow",
    agentResponse: "I'll cancel your appointment for 123 Main Street...",
    interruptAt: "123 Main",
    userInterruption: "No, the other address",
    expectedBehavior: "stop_and_address_correction",
  },
];

async function runBargeInTest(test: BargeInTest): Promise<TestResult> {
  // Start agent response
  const responsePromise = agent.speak(test.agentResponse);

  // Wait until specific content is spoken
  await waitForSpokenContent(test.interruptAt);

  // Simulate user interruption
  const startTime = Date.now();
  agent.interrupt(test.userInterruption);

  // Measure response
  const result = await responsePromise;
  const latency = Date.now() - startTime;

  return {
    passed: result.behavior === test.expectedBehavior &&
            (!test.expectedLatencyMs || latency <= test.expectedLatencyMs),
    actualBehavior: result.behavior,
    latencyMs: latency,
  };
}
```

---

## Conclusion

The current PestCall prototype provides a solid foundation but is limited by its reliance on a smaller language model. By upgrading to Claude Sonnet 4 or GPT-4o through Cloudflare AI Gateway, and implementing a proper voice pipeline with OpenAI Realtime or LiveKit, we can achieve:

1. **Dramatically improved function calling reliability** (60%+ improvement)
2. **True real-time voice interactions** (<500ms latency)
3. **Better cost efficiency** through caching and smart routing
4. **Enhanced observability** via AI Gateway analytics
5. **Production-grade scalability** with multi-provider fallbacks

The recommended approach balances keeping valuable infrastructure (Durable Objects, Cloudflare edge) while upgrading the AI capabilities to meet production requirements for a voice-first customer service system.

---

*Document prepared for PestCall Architecture Review - January 2026*

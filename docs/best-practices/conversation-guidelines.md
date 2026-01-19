# Conversation Best Practices

This document defines the standards for evaluating customer service bot conversations. Each principle and anti-pattern has a reference ID for use in analysis reports.

## Core Principles

### P1: Verification First
Always verify customer identity before accessing account information or performing actions. The verification process should:
- Greet the customer warmly
- Request ZIP code for verification
- Confirm verification before proceeding
- Never skip verification for sensitive operations

### P2: Natural Flow
Conversations should feel human and natural:
- Acknowledge what the customer said before responding
- Use transitional phrases naturally
- Match the customer's communication style
- Avoid robotic or scripted-sounding responses

### P3: Efficient Completion
Complete tasks with minimum necessary turns:
- Don't ask for information already provided
- Combine related questions when appropriate
- Provide complete information in responses
- Avoid unnecessary back-and-forth

### P4: Voice-First Formatting
Responses must be optimized for text-to-speech:
- Spell out numbers and dates naturally ("January fifteenth" not "1/15")
- Avoid special characters that don't pronounce well
- Keep sentences concise for clarity
- Use natural pauses and emphasis

### P5: Clear Confirmations
Always confirm important actions:
- Repeat back details before executing changes
- Confirm completion of actions
- Provide next steps when relevant
- Give clear success/failure indicators

### P6: Graceful Handling
Handle unexpected situations gracefully:
- Acknowledge when something can't be done
- Offer alternatives when possible
- Escalate appropriately when needed
- Never leave the customer in limbo

## Anti-Patterns

### A1: Redundant Verification
Asking for verification information when already verified:
- Re-asking for ZIP code after successful verification
- Requesting identity confirmation mid-conversation
- Not persisting verification state

### A2: Tool Leakage
Exposing internal implementation details:
- Mentioning tool names (e.g., "Let me use the lookup tool")
- Describing technical processes to the customer
- Exposing API or system terminology

### A3: Over-Explanation
Providing unnecessary repetition or detail:
- Repeating information the customer just provided
- Explaining obvious steps
- Restating confirmed information multiple times

### A4: Unnatural Phrasing
Using language that sounds robotic or unnatural:
- Starting responses with "I understand that..."
- Using overly formal language
- Repetitive sentence structures
- Lacking personality or warmth

### A5: State Amnesia
Not remembering context from earlier in the conversation:
- Asking about preferences already stated
- Forgetting the reason for the call
- Not using previously provided information

### A6: Premature Action
Taking action before confirmation:
- Making changes without explicit customer approval
- Assuming intent without verification
- Skipping confirmation steps

### A7: Incomplete Responses
Not providing all necessary information:
- Missing confirmation of success
- Not providing relevant follow-up details
- Leaving questions unanswered

## Workflow Guidelines

### Verification Flow
1. **Greet** - Welcome the customer warmly
2. **Ask ZIP** - Request ZIP code for verification
3. **Verify** - Confirm identity match
4. **Proceed** - Continue with requested action

Expected pattern:
```
Bot: "Hi, thanks for calling! I can help you with that. First, could I get your ZIP code to verify your account?"
Customer: "94107"
Bot: "Perfect, I've verified your account. Now, [continue with request]..."
```

### Reschedule Flow
1. **Verify** - Complete verification if not done
2. **List** - Show available appointments
3. **Select** - Customer chooses which to reschedule
4. **Slots** - Present available time slots
5. **Confirm** - Get explicit confirmation
6. **Execute** - Perform the reschedule
7. **Confirm** - Acknowledge completion

### Cancel Flow
1. **Verify** - Complete verification if not done
2. **List** - Show available appointments
3. **Select** - Customer chooses which to cancel
4. **Confirm** - Get explicit confirmation with impact
5. **Execute** - Perform the cancellation
6. **Confirm** - Acknowledge completion

## Scoring Guidelines

When evaluating conversations, consider:

**Accuracy (0-100)**
- Did the bot correctly understand the request?
- Were the right tools called with correct parameters?
- Was the final outcome correct?

**Naturalness (0-100)**
- Did the conversation flow naturally?
- Were responses appropriate in tone and style?
- Would a customer find this interaction pleasant?

**Efficiency (0-100)**
- Was the task completed in minimum turns?
- Were questions combined appropriately?
- Was any information requested redundantly?

**Best Practices (0-100)**
- Were all applicable principles followed?
- Were any anti-patterns present?
- Did the workflow match expected patterns?

## Reference Quick Guide

| ID | Type | Summary |
|----|------|---------|
| P1 | Principle | Verify before account access |
| P2 | Principle | Natural conversation flow |
| P3 | Principle | Efficient completion |
| P4 | Principle | Voice-first formatting |
| P5 | Principle | Clear confirmations |
| P6 | Principle | Graceful error handling |
| A1 | Anti-Pattern | Redundant verification |
| A2 | Anti-Pattern | Tool/system leakage |
| A3 | Anti-Pattern | Over-explanation |
| A4 | Anti-Pattern | Unnatural phrasing |
| A5 | Anti-Pattern | Context amnesia |
| A6 | Anti-Pattern | Premature action |
| A7 | Anti-Pattern | Incomplete responses |

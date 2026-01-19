# Verification Scenario Issues

**Evaluation Date:** 2026-01-19
**Category:** verification

## Status: RESOLVED

**Before Fix:** Pass Rate 1/5 (20%), Average Score 57/100
**After Fix:** Pass Rate 5/5 (100%), Average Score 86/100

The critical issue was a missing greeting flow in the prompt. Fixed by adding explicit instructions for handling customer greetings in `prompt-provider.ts`.

---

## Historical Issues (Resolved)

### 1. Bot Fails to Handle Simple Greetings

**Severity:** Critical
**Affected Scenarios:** verification-happy-path, verification-wrong-zip, verification-zip-with-leading-zero, verification-no-redundant-ask

When a customer sends a simple greeting like "Hello" or "Hi there", the bot responds with:

> "I'm not sure how to respond to that."

This is a fundamental failure in customer service. The bot should:
- Greet the customer warmly
- Ask for their ZIP code to begin verification

**Root Cause:** The prompt or model is not handling conversational greetings properly. It may be expecting specific inputs rather than natural conversation starters.

### 2. Leading Zero ZIP Codes Fail Completely

**Severity:** Critical
**Affected Scenarios:** verification-zip-with-leading-zero

ZIP code `02101` (Boston area) causes a complete failure:
- No `crm.verifyAccount` tool call is made
- Bot responds with "I'm not sure how to respond to that."
- AI Score: 0/100

**Root Cause:** Likely a parsing issue where leading zeros are stripped or the ZIP is being treated as an invalid number.

### 3. Redundant Tool Calls

**Severity:** Medium
**Affected Scenarios:** verification-natural-conversation

The bot called `crm.verifyAccount` multiple times in a single conversation turn:

> *Tools:* crm.verifyAccount, crm.verifyAccount

This is inefficient and could cause issues with idempotency.

## Scoring Issues

### Current Scores Are Too Lenient

The evaluation gave 60/100 to conversations where the bot:
- Failed to greet the customer
- Responded with "I'm not sure how to respond to that."
- Only passed 1 of 2 steps

A conversation that fails basic greeting should score much lower (below 40).

### Best Scenario Still Has Problems

The only passing scenario (`verification-natural-conversation`) scored 85/100 but had:
- Formal/robotic phrasing: "Hello Alex Rivera!"
- Multiple redundant verifyAccount calls
- Could improve warmth in initial response

An 85 should represent a nearly flawless conversation, not one with these issues.

## Recommended Fixes

### Bot Behavior Fixes

1. **Add greeting handling to prompts** - The system prompt should explicitly handle common greetings and initiate the verification flow
2. **Fix ZIP code parsing** - Ensure leading zeros are preserved (treat as strings, not numbers)
3. **Prevent duplicate tool calls** - Add deduplication logic or adjust prompts to prevent redundant calls

### Evaluator Fixes

1. **Stricter scoring scale** - A score of 90+ should require:
   - Perfect natural language with no robotic phrasing
   - No redundant operations
   - Warm, engaging tone throughout
   - Efficient conversation flow

2. **Penalize critical failures more heavily** - "I'm not sure how to respond to that" should result in scores below 30

3. **Add specific deductions for:**
   - Unnatural phrasing (-15 points)
   - Redundant tool calls (-10 points per duplicate)
   - Failed greetings (-25 points)
   - Tool leakage/internal references (-20 points)

## Action Items

- [ ] Fix greeting handling in conversation prompts
- [ ] Fix leading zero ZIP code parsing
- [ ] Add tool call deduplication
- [ ] Update evaluator scoring to be stricter
- [ ] Re-run verification scenarios after fixes

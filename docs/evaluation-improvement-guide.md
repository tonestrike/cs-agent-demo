# Evaluation Improvement Guide

This document explains how to use conversation analyzer results to systematically improve the AI agent system.

## Quick Reference

After running evaluations, follow this decision tree:

```
Score < 50? → Check for critical failures (broken prompts, tool failures)
Score 50-70? → Review prompt instructions, check for anti-patterns
Score 70-85? → Fine-tune naturalness, efficiency optimizations
Score > 85? → Minor polish, edge case handling
```

## Critical Principle: AI Score vs Pass/Fail

**IMPORTANT:** Pass/fail for step expectations is NOT the same as conversation quality.

A scenario can "pass" (all steps pass their expectations) while having a terrible conversation. For example:
- `cancel-no-appointments`: 3/3 steps passed, but AI score 40/100 - bot couldn't verify customer

**Why this happens:** Step expectations only check if patterns appear in responses. They don't evaluate:
- Whether the conversation makes sense end-to-end
- Whether a human could meaningfully respond to what the bot said
- Whether the task was actually accomplished
- Whether the experience would frustrate a real customer

**How to interpret results:**
| Pass Rate | AI Score | Interpretation |
|-----------|----------|----------------|
| High | High (85+) | Genuinely good - bot works well |
| High | Low (<60) | **False positive** - expectations too lenient, conversation broken |
| Low | High | Expectations too strict or test data issues |
| Low | Low | Genuine failure - both tests and quality show problems |

**Action:** When pass rate is high but AI score is low, READ THE CONVERSATION TRANSCRIPT. The transcript reveals the actual customer experience.

## Evaluation Categories

### Accuracy Issues (Tool/Response Problems)

**Symptoms:**
- Tools not being called when expected
- Wrong tools called
- Incorrect arguments passed
- Bot says "I'm not sure how to respond"

**Root Cause Analysis:**
1. Read the prompt in `prompt-provider.ts`
2. Check if the instruction exists for the user's request
3. Verify tool definitions in `tool-definitions.ts`
4. Check tool handlers in `tool-flow/handlers/`

**Fix Locations:**
- `apps/worker/src/durable-objects/conversation-session/v2/providers/prompt-provider.ts` - System prompt instructions
- `apps/worker/src/models/tool-definitions.ts` - Tool schemas
- `apps/worker/src/durable-objects/conversation-session/tool-flow/` - Tool handlers

### Naturalness Issues (Robotic/Stiff Language)

**Symptoms:**
- "I understand that..." or "I'm sorry, but..."
- Overly formal greetings like "Hello [Name]!"
- Repetitive sentence structures
- Not acknowledging what customer said

**Root Cause Analysis:**
1. Check the system prompt for language examples
2. Look for prescriptive phrases that the model copies
3. Review if prompt allows natural variation

**Fix Approaches:**
- Add anti-pattern examples to the prompt ("Do NOT say...")
- Provide better response examples
- Use softer instructions that allow variation

### Efficiency Issues (Too Many Turns)

**Symptoms:**
- Asking for info already provided
- Redundant tool calls
- Not combining related questions
- Unnecessary back-and-forth

**Root Cause Analysis:**
1. Check if state is being properly tracked
2. Verify tool results are being used
3. Look for prompt instructions causing extra turns

**Fix Locations:**
- `apps/worker/src/durable-objects/conversation-session/v2/state.ts` - State management
- Prompt instructions - Combine steps when appropriate

### Best Practices Violations

**Symptoms:**
- Tool names mentioned to customer (A2: Tool Leakage)
- Re-asking for verification (A1: Redundant Verification)
- Not confirming before actions (P5: Clear Confirmations)

**Fix Approach:**
Add explicit instructions to the prompt:
```typescript
"CRITICAL RULES:",
"- NEVER mention tool names to customers",
"- NEVER re-ask for ZIP code after verification",
"- ALWAYS confirm before making changes",
```

## Improvement Workflow

### Step 1: Run Evaluation

```bash
bun run scripts/run-analyzer.ts --category <category> --with-analysis --save --verbose
```

### Step 2: Identify Pattern

Look at the AI analysis findings and categorize:
- `[high]` severity → Must fix
- `[medium]` severity → Should fix
- `[low]` severity → Nice to fix

### Step 3: Locate Root Cause

| Issue Type | First Place to Check |
|------------|---------------------|
| Not greeting | `prompt-provider.ts` unverified prompt |
| Not calling tools | `prompt-provider.ts` verified prompt |
| Tool failures | Tool handler in `tool-flow/handlers/` |
| State not persisting | `state.ts` or domain state handling |
| Robotic language | System prompt examples/instructions |

### Step 4: Make Change

1. Edit the relevant file
2. Deploy: `bun deploy:worker`
3. Re-run evaluation for that category

### Step 5: Document

If the issue was significant, document it in `docs/evaluation-issues/<category>-issues.md`:
- What was the symptom
- What was the root cause
- How it was fixed
- Before/after scores

## Common Fixes

### Fix: Bot Not Handling Greetings

**Symptom:** "I'm not sure how to respond to that" when customer says "Hello"

**Fix:** Add greeting instructions to unverified prompt in `prompt-provider.ts`:
```typescript
"GREETING FLOW:",
"1. When the customer greets you, warmly greet them back",
"2. Ask for their ZIP code to verify their account",
```

### Fix: Redundant Tool Calls

**Symptom:** Same tool called multiple times in one turn

**Fix:** Add deduplication or adjust prompt to prevent repeated calls.

### Fix: Formal/Robotic Language

**Symptom:** "Hello Alex Rivera!" with exclamation

**Fix:** Add natural language examples:
```typescript
"Be conversational and warm, not formal. Instead of 'Hello Alex Rivera!', say 'Hi Alex' or 'Hey there'",
```

### Fix: Tool Leakage

**Symptom:** Bot mentions "crm.verifyAccount" or other internal names

**Fix:** Add explicit prohibition:
```typescript
"NEVER mention tool names, system names, or internal processes to the customer",
```

## Architectural Considerations

### When to Use RAG

Consider RAG when:
- Bot needs access to frequently changing information
- Responses require domain knowledge not in training
- Need to reference external documentation

RAG implementation: `apps/worker/src/rag/`

### When to Adjust Tool Definitions

Consider adjusting tools when:
- Bot consistently uses wrong parameters
- Tool description is ambiguous
- New capability is needed

Tool definitions: `apps/worker/src/models/tool-definitions.ts`

### When to Add Workflow State

Consider adding workflow state when:
- Multi-step operations lose context
- Bot re-asks for already-provided information
- Need to track operation progress

State handling: `apps/worker/src/durable-objects/conversation-session/v2/`

## Evaluation File Structure

Results are saved to `evaluations/YYYY-MM-DD_HH-MM-SS_<category>.md`:
- Summary table with pass rate and average score
- Per-scenario breakdown with conversation transcript
- AI analysis findings with best practice references
- Specific recommendations

Use these files to track improvement over time.

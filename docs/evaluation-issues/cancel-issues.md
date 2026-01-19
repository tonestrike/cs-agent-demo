# Cancel Scenario Issues

**Evaluation Date:** 2026-01-19
**Category:** cancel

## Status: FIXED (pending re-evaluation)

**Previous Results:** Pass Rate 4/5 (80%), Average Score 59/100

**CRITICAL INSIGHT:** The 80% pass rate is completely misleading. Looking at the actual conversations, 4 out of 5 scenarios are disasters where the bot couldn't even verify the customer. "Passing" expectations means nothing if the conversation itself is unusable.

**Real Performance by AI Score:**
- 1 scenario works well (92/100)
- 4 scenarios are failures (40-82/100, most at 40/100)

The pass/fail metric must be interpreted alongside conversation quality. A "pass" with a 40/100 AI score is not a pass - it's a testing gap.

---

## Active Issues

### 1. ZIP Code 98109 Not in Mock CRM Data

**Severity:** Critical
**Affected Scenarios:** cancel-happy-path, cancel-no-appointments, cancel-confirmation-required, cancel-natural-language

4 out of 5 cancel scenarios use ZIP code `98109` which doesn't exist in the mock CRM customer data. The verification always fails:

> "I'm sorry, but it seems we don't have an account linked to the provided ZIP code."

**Evidence:**
- `cancel-verified-first` uses ZIP `94107` → Score: 92/100 (passes)
- `cancel-happy-path` uses ZIP `98109` → Score: 40/100 (fails verification)
- `cancel-no-appointments` uses ZIP `98109` → Score: 40/100 (fails verification)
- `cancel-confirmation-required` uses ZIP `98109` → Score: 40/100 (fails verification)
- `cancel-natural-language` uses ZIP `98109` → Score: 82/100 (fails verification but passes expectations)

**Root Cause (FIXED):** The `CRM_PROVIDER` was set to `"mock"` in `wrangler.toml`, which used hardcoded fixture data instead of the D1 database. The scenario runner's `seedTestData` was correctly writing to D1, but verification used the mock adapter which only knew about fixtures.

**Fix Applied:**
1. Changed `CRM_PROVIDER = "d1"` in `apps/worker/wrangler.toml`
2. Added `"d1"` to the CRM provider enum in `apps/worker/src/env.ts`
3. Now seeding via `admin/createCustomer` writes to D1, and verification reads from D1

### 2. Scenario Definition Discrepancy

**Severity:** High
**Location:** `scripts/run-analyzer.ts` vs `apps/worker/src/analyzer/scenarios/cancel.ts`

There are TWO sets of scenario definitions:
1. **Inline definitions** in `scripts/run-analyzer.ts` (used by CLI) - uses ZIP `98109`
2. **Separate files** in `apps/worker/src/analyzer/scenarios/` - uses ZIP `60601`

The CLI uses the inline definitions, not the separate files. This creates confusion and maintenance burden.

### 3. Redundant Tool Calls

**Severity:** Medium
**Affected Scenarios:** cancel-verified-first

Bot calls `crm.verifyAccount` twice in the same turn:

> *Tools:* crm.verifyAccount, crm.listUpcomingAppointments

And again after verification:

> *Tools:* crm.verifyAccount, crm.listUpcomingAppointments

---

## Scoring Analysis

### The Pass/Fail Trap

**This is a core lesson:** Pass/fail for step expectations is NOT the same as conversation quality.

Consider `cancel-no-appointments`:
- **Pass/Fail:** 3/3 steps passed
- **AI Score:** 40/100
- **Reality:** Complete failure - bot couldn't verify customer, asked for ZIP code twice

The step expectations only check if certain patterns appear in responses. They don't evaluate:
- Whether the conversation makes sense
- Whether a human could actually respond to what the bot said
- Whether the task was actually accomplished
- Whether the bot's responses would frustrate a real customer

**Benchmark Principle:** AI Score is the true quality metric. Pass/fail is a sanity check.

### False Positives in Current Results

3 scenarios pass despite being unusable conversations:
- `cancel-no-appointments`: 3/3 steps, 40/100 score - **UNUSABLE**
- `cancel-confirmation-required`: 3/3 steps, 40/100 score - **UNUSABLE**
- `cancel-natural-language`: 3/3 steps, 82/100 score - **DEGRADED**

The expectations don't require actual verification success, just that patterns are present in responses.

### True Performance (with valid ZIPs)

Only `cancel-verified-first` (ZIP 94107) shows real bot performance:
- Score: 92/100
- All steps pass with actual verification working
- Natural conversation flow

---

## Recommended Fixes

### Priority 1: Fix Scenario Data Seeding

The `seedAppointment: true` flag should create test customers, but verification is failing. Need to ensure scenario setup properly seeds:

1. **Customer record** with matching ZIP code (98109)
2. **Phone number** association
3. **Appointment** data (if `seedAppointment: true`)

See [Architectural Issues - Test Data Seeding](./architectural-issues.md#3-test-data-seeding-for-scenarios) for details.

**Investigation needed:**
- Check how seeding works in `scripts/run-analyzer.ts`
- Verify mock CRM accepts seeded data for `crm.verifyAccount`

### Priority 2: Consolidate Scenario Definitions

Either:
1. **Remove inline definitions** from `run-analyzer.ts` and use the module imports from `apps/worker/src/analyzer/scenarios/`
2. **Or** delete the separate scenario files and keep only inline definitions

Current state creates maintenance burden and confusion.

### Priority 3: Fix Tool Call Deduplication

Prevent `crm.verifyAccount` from being called multiple times when customer is already verified.

### Priority 4: Update Expectations

Make expectations stricter to actually require verification success:

```typescript
expectations: {
  toolCalls: [{ name: "crm.verifyAccount" }],
  stateChanges: { "conversation.verification.verified": true }, // Require actual verification
  responsePatterns: ["(verified|found)"],
  responseExcludes: ["sorry", "don't have", "couldn't find"], // Exclude failure messages
}
```

---

## Action Items

- [x] ~~Add customer data for ZIP 98109 to mock CRM~~ → Fixed by switching to D1 CRM adapter
- [x] ~~Fix cancel-no-appointments seeding~~ → Added seedCustomer option to seed customer without appointment
- [ ] Consolidate scenario definitions (inline vs separate files)
- [ ] Add tool call deduplication to prevent redundant verifyAccount calls
- [ ] Update expectations to require actual verification success
- [ ] Re-run cancel scenarios after fixes and redeploy

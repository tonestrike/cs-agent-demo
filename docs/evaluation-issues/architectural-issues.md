# Architectural Issues

Tracking non-scenario-specific issues that affect overall conversation quality.

---

## 1. Butt-in (Interruption) Not Working

**Status:** OPEN
**Severity:** High
**Component:** Realtime Kit / WebSocket handling

**Problem:**
When a user interrupts the bot mid-response, the realtime kit continues responding instead of stopping. The bot should detect the interruption and immediately yield the floor to the user.

**Expected behavior:**
- User starts speaking while bot is responding
- Bot immediately stops its current response
- Bot listens to what the user says
- Bot responds to the user's new input

**Current behavior:**
- User starts speaking while bot is responding
- Bot continues its response to completion (ignoring the interruption)
- User's input may be lost or processed after the bot finishes

**Likely location:**
- `apps/worker/src/durable-objects/conversation-session/` - WebSocket handling
- Realtime Kit client-side interruption detection
- VAD (Voice Activity Detection) configuration

**Investigation needed:**
- [ ] Check if interruption events are being sent from client
- [ ] Check if server is receiving and processing interruption events
- [ ] Check if there's a flag to cancel current TTS/response stream

---

## 2. Responses Too Text-Based / Not Conversational

**Status:** OPEN
**Severity:** Medium
**Component:** Prompt Provider / Response Generation

**Problem:**
When returning appointment information, the bot speaks in a structured, text-based format that doesn't sound natural in conversation.

**Example of current behavior:**
```
You currently have one appointment scheduled. Here are the details:

Date: February 10, 2025
Time Window: 10:00 AM - 12:00 PM
Address: 742 Evergreen Terrace

Is there anything else you would like to know?
```

**Example of expected conversational behavior:**
```
You've got an appointment coming up on February 10th between 10 and noon at 742 Evergreen Terrace. Would you like to make any changes to that?
```

**Issues with current format:**
- Bulleted/structured lists don't translate well to speech
- Appointment IDs should never be mentioned (internal detail)
- Dates/times should be spoken naturally ("February 10th" not "February 10, 2025")
- Time windows should be casual ("between 10 and noon" not "10:00 AM - 12:00 PM")
- Should sound like a human would actually say it

**Fix locations:**
- `apps/worker/src/durable-objects/conversation-session/v2/providers/prompt-provider.ts` - Add instructions for conversational formatting
- Possibly add post-processing to convert structured data to natural speech

**Prompt fix example:**
```typescript
"RESPONSE FORMAT:",
"- Speak naturally as if on a phone call",
"- Never use bullet points, numbered lists, or structured formats",
"- Say dates casually: 'February 10th' not 'February 10, 2025'",
"- Say times casually: 'between 10 and noon' not '10:00 AM - 12:00 PM'",
"- Never mention appointment IDs or internal identifiers",
"- Keep responses concise - one or two sentences when possible",
```

---

## 3. Test Data Seeding for Scenarios

**Status:** FIXED
**Severity:** High
**Component:** Conversation Analyzer / CRM Provider

**Problem:**
Scenarios use ZIP codes that don't exist in the mock CRM data, causing verification failures.

**Root cause:**
`CRM_PROVIDER = "mock"` in `wrangler.toml` forced the mock CRM adapter, which uses hardcoded fixtures. The scenario runner's `seedTestData` correctly wrote to D1 via `admin/createCustomer`, but verification used the mock adapter which only knew about fixtures.

**Fix applied:**
1. Changed `CRM_PROVIDER = "d1"` in `apps/worker/wrangler.toml`
2. Added `"d1"` to the CRM provider enum in `apps/worker/src/env.ts`
3. Updated `apps/worker/src/crm/index.ts` to handle "d1" case explicitly

Now seeding works correctly:
- `admin/createCustomer` writes customer to D1 `customers_cache` table
- `admin/createAppointment` writes appointment to D1 `appointments` table
- D1 CRM adapter reads from these tables for verification

---

## Priority Order

1. **Butt-in** - Critical for voice UX, users expect interruption to work
2. **Conversational format** - Significantly impacts naturalness scores
3. ~~**Test data seeding**~~ - FIXED: Now uses D1 database for seeding and verification

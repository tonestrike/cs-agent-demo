# Conversation architecture refactor
Split conversational streaming from deterministic control work using a Worker + Durable Object session brain, with tools as the only source of business truth.

## Intent
- Make streaming feel instant while keeping verification, appointments, and cancellations correct and auditable.
- Stop relying on model JSON compliance for control flow.
- Persist per-session state so reconnects are safe and context does not reset.

## Current problems (observed)
- Slow first response: tokens arrive only after routing + tool calls, making the UI feel frozen.
- Disjointed outputs: RPC replies and WS stream disagree or arrive out of order.
- Transport confusion: SSE + WS compete, leading to event ordering bugs and duplicate render paths.
- Robotic prompts: verification responses sound canned and ignore user intent.
- Misrouted scheduling: "schedule" or "when is available" sometimes triggers reschedule/cancel or appointment listing.
- Missing context carry: intent before verification is lost after ZIP verification.
- Confirmation bugs: reschedule/cancel confirmed without presenting options.
- Streaming failures: OpenRouter SSE parsing errors caused fallback to Workers AI.
- Narrator output leaks JSON or goes empty, causing silent turns and unreadable responses.
- Status text replaces the acknowledgement instead of augmenting it.
- Latency visibility is limited; cannot filter by `callSessionId` to diagnose slow turns.
- Action safety ambiguity: model‑selected tools are treated as decisions, not proposals.
- State machine gaps: scheduling/rescheduling/slot selection are under‑modeled, leading to prompt hacks.
- Debugging difficulty: no turn‑by‑turn summary tying model calls, tools, and latency together.

## Example conversations (why they’re bad)
### Example 1: Verification feels robotic and loses intent
User: "When is my next appointment?"
Agent: "Please provide the 5-digit ZIP code on your account so I can verify it and pull up your details."
User: "94107"
Agent: "Thanks, you're verified. What would you like to do next?"

Issues:
- The user intent (next appointment) is dropped after verification.
- The verification prompt sounds procedural rather than conversational.

Fix:
- Store pending intent before verification.
- Narrator generates a friendly verification request that acknowledges the question.
- After verification, continue the original request automatically.

### Example 2: Scheduling vs rescheduling confusion
User: "Schedule another appointment"
Agent: "Got it. I can help reschedule an appointment..."
Agent: "Here is your upcoming appointment..."

Issues:
- Reschedule flow triggered when the user asked to schedule a new appointment.
- Appointments listing is used for availability rather than new slots.

Fix:
- Route schedule/availability to `getAvailableSlots`.
- Ask to confirm the on-file address before requesting a new one.
- Use one model decision to pick the tool (no deterministic overrides).

### Example 3: Confirmation without options
User: "Reschedule"
Agent: "Thanks. I'll finalize the reschedule now."
User: "But for when?"

Issues:
- Reschedule confirmed without presenting available slots.
- Confirms before user selects a new time.

Fix:
- Require slot presentation and explicit selection before confirm.
- Keep reschedule state in DO and enforce gating.

### Example 4: Empty or JSON-encoded assistant output
User: "Hi"
Agent: "" (empty)
User: "What is happening"
Agent: `{"answer":"Could you please share..."}{"answer":"Thanks, Alex — ..."}`

Issues:
- Empty assistant messages can appear (no immediate ack).
- Model JSON leaks into user-facing text, creating unreadable replies.

Fix:
- Ensure first-token-fast narrator text is always emitted.
- Never pass JSON mode outputs into narrator; only use plain text streams.
- Strip/guard against structured JSON in narrator output.

## Current state
- The agent loop lives in [`agent.ts`](../apps/worker/src/use-cases/agent.ts) with a DB-backed call summary.
- Streaming is simulated in [`pestcall.ts`](../apps/worker/src/agents/pestcall.ts) and broadcast through [`conversation-hub.ts`](../apps/worker/src/durable-objects/conversation-hub.ts).
- A single model does decision + response + status, which makes control flow brittle when output is ambiguous.

## Target architecture
### Edge Worker
- Terminates HTTP, authenticates, rate limits, and routes requests.
- Exposes:
  - WebSocket endpoint for assistant output (authoritative).
  - oRPC endpoint to send user turns (input only).
  - Optional SSE adapter that replays WebSocket events for compatibility.
- Forwards all conversation logic to a session Durable Object.

### Conversation session Durable Object
- Holds session state and dialog state machine.
- Orchestrates tool calls and model calls.
- Emits events into the client stream (token/status/final/error).
- Never performs side effects without explicit confirmation.
- Owns realtime call loop, including barge-in and transcript boundary handling.

### Tools layer
- Deterministic adapters with Zod validation.
- Example tools:
  - `VerifyCustomer(phone, zip)`
  - `ListAppointments(customerId)`
  - `CancelAppointment(appointmentId)`
- Models do not “simulate” these results.
- Model output is treated as a proposal, validated against an ActionPlan schema.

### Model layer (two roles)
- Narrator: streams user-facing text (no JSON).
- Interpreter: tiny structured decisions (yes/no confirmation, option selection).
- Interpreter output always validated.
- Intent routing should be model-driven (constrained schema), with deterministic gates for high‑risk actions.
- Models can propose; code disposes (ActionPlan validation + policy gate).
- Narrator is the only source of outbound text and always uses tool/context inputs.
- Interpreter is limited to: intent classification, option selection, confirmation yes/no.
- Acknowledge intent immediately with narrator tokens before routing/tools run.
- Status updates must be additive (never replace the narrator acknowledgement).

## Conversation state machine
States (owned by code, not the model):
- `CollectingVerification`
- `VerifiedIdle`
- `DisambiguatingIntent`
- `PresentingAppointments`
- `PresentingSlots`
- `PendingCancellationConfirmation`
- `PendingRescheduleConfirmation`
- `PendingScheduleDetails`
- `Completed`

Transitions:
- `CollectingVerification` → `VerifiedIdle` after `VerifyCustomer`.
- `VerifiedIdle` → `PresentingAppointments` after `ListAppointments`.
- `PresentingAppointments` → `PendingCancellationConfirmation` after user selects.
- `PendingCancellationConfirmation` → `Completed` after confirmation + `CancelAppointment`.
- `PresentingAppointments` → `PresentingSlots` after selecting appointment for reschedule.
- `PresentingSlots` → `PendingRescheduleConfirmation` after slot selected.
- `PendingRescheduleConfirmation` → `Completed` after `RescheduleAppointment`.
- `VerifiedIdle` → `PendingScheduleDetails` for new scheduling flow (address/notes).

## Event protocol (WS payloads)
Required fields:
- `seq`: monotonic per session event id.
- `turnId`: monotonic per user turn.
- `messageId`: assistant message being streamed.
- `role`: `assistant` or `system` (status).
- `type`: `token` | `status` | `final` | `error` | `resync` | `speaking`.
- `text`: optional, for `token`/`status`.
- `data`: optional, for `final`/`resync`/`speaking`.
- `correlationId`: optional, for tool progress events.

The Worker forwards the DO event stream to the client unchanged.

## Cloudflare realtime alignment
- Use RealtimeKit Core SDK for voice sessions (low WebRTC overhead, fast setup).
- Consume RealtimeKit `meeting.ai` transcripts; honor `isPartialTranscript`.
- Only act on `final_transcript` events; partials are UI-only.
- Enable `transcription_enabled` in presets for voice users; configure language + keywords.
- Keep TURN as automatic fallback via RealtimeKit/SFU (no custom TURN wiring needed).
- Use WebSocket as the single source of assistant output; RPC is input-only.
- Emit the first narrator token immediately, then run tool calls concurrently.
- Collapse routing + tool decision into a single model call to reduce latency.
- Capture AI Gateway trace ids when available to correlate slow turns.
- Log `first_token_ms` and `time_to_status_ms` per turn with `callSessionId` to make log filtering trivial.

## Decisions (locked)
- Output authority: WebSocket events are the source of truth; RPC is only input.
- Tool execution: only tools can mutate state; model text is never treated as facts.
- Confirmation gating: cancellations/reschedules require explicit confirmation after options.
- Storage split: DO for live state, D1 for summaries and audit trail.
- Realtime transport: RealtimeKit for voice; WebSocket for typed text.
- SSE is compatibility only, implemented as a thin adapter replaying WS events.
- Open questions resolved:
  - RPC vs WS output: WS is authoritative; RPC is input-only.
  - Model routing: single-pass tool decision (no separate routing call).
  - Verification: prompts are narrator-generated and acknowledge intent.
- Narrator text is plain text only; any JSON-like output is stripped before emitting tokens.
- Acknowledgements are narrator-generated and streamed before tool calls.
- Status events supplement, never replace, acknowledgement text.
- ActionPlan validation gates all model‑proposed tool calls.
- Sessions can start without a verified customer; pre-verification realtime participants are allowed and should be keyed to the session, then linked to the customer after verification.

## Decisions (open)
- RealtimeKit text adoption: keep custom UI for typed chat; revisit only if we need a unified voice+text session UI.
- Prefetch strategy: pull appointments/slots after verification to reduce perceived latency.
- Provider split: narrator streaming on most reliable direct provider; interpreter/decision on cheaper model.
- Streaming fallback policy: when to switch to non-streamed respond and/or alternate provider.

## Streaming requirements (must-haves)
- Acknowledgement first token is streamed for reschedule/cancel/appointments/billing intents.
- Status events are additive and never substitute for narrator text.
- Narrator streaming must work even when workflow-driven or tool results are pending.
- Per-turn latency (`first_token_ms`, `time_to_status_ms`) is logged with `callSessionId`.
- Provide a human-readable markdown summary per conversation including model/tool details and latency.

## Plan (current work)
1) Streaming diagnostics
   - Log `content-type`, `cache-control`, `transfer-encoding` for OpenRouter streams.
   - Record `firstChunkMs`, `lineCount`, `eventCount`, `deltaCount`, `emptyDeltaCount`, and key histograms.
   - Sample first/last SSE line for each stream.
2) Streaming robustness
   - Expand SSE parsing to accept multiple delta/message shapes.
   - Fallback emit: if a stream ends with zero deltas but has a final message, emit that content.
   - Optional future: timeout fallback to `respond` when no tokens in N ms.
3) Status guidance centralization
   - Single shared tool-status config for context hints passed to the model.
   - Remove duplicated status/ack maps from per-call sites; all text is model-generated.
4) Context hygiene
   - Keep status turns in storage for audit but exclude from model context.
   - Enforce consistent ordering (chronological) for model input.
5) Provider strategy (next)
   - A/B: Workers AI for `status` + `respond`, OpenRouter for `generate`.
   - If streaming still fails, move narrator streaming to direct SDK path.


## API surface
### Worker endpoints
- `GET /api/conversations/:id/socket` → WebSocket stream (authoritative).
- `GET /api/conversations/:id/stream` → SSE adapter that replays WS events.
- `POST /api/conversations/:id/message` → oRPC (send user turn).
- `GET /api/conversations/:id/summary` → markdown summary of conversation (debugging).

### Durable Object endpoints
- `GET /socket` → WebSocket stream for session events (authoritative).
- `GET /stream` → SSE adapter stream.
- `POST /message` → ingest user turn, enqueue events, run state machine.
- `GET /summary` → markdown summary for a call session id.

## Data and storage
- Session state in DO storage:
  - verification status, pending confirmation, cached appointments.
- Long-term audit in D1:
  - call turns, tool calls, final outcomes, and summaries.
  - Durable record for dropped voice sessions.
- Tool results stored as snapshots for replay and debugging.

## Replay strategy
- Short reconnect: replay from DO event buffer, then emit `resync` with `speaking` + state.
- Long reconnect: rebuild from DO snapshot + D1 summaries, emit `resync` with a full snapshot.
- Audit truth: D1 is the authoritative record; DO is operational and ephemeral.

## Current architecture (implemented)
- ConversationSession DO is live with WS streaming + resync and state storage.
- RPC `/message` is input‑only and returns `{ ok, callSessionId }`.
- Tool‑backed flows exist for verification, appointments, cancel/reschedule, billing, escalation.
- Narrator streaming and model‑driven tool proposals are active.
- WS is authoritative; SSE exists only for compatibility.

## Planned work (deltas only)
1) **State machine expansion**
   - Add schedule/reschedule/slot selection states.
   - Encode invariants as code rules (no prompt‑only enforcement).
2) **Replay + audit**
   - Formalize short vs long reconnect behavior.
   - Emit a state snapshot on resync for long gaps.
3) **Voice integration**
   - Wire RealtimeKit transcripts to DO with `final_transcript`.
4) **Latency + observability**
   - Add AI Gateway trace ids to log context.
   - Track per‑turn latency with `callSessionId` and `turnId`.

## Task breakdown
### Status snapshot
Done:
- ConversationSession DO with WS events, resync, and state storage.
- Tool-backed flows for verification, appointments, cancel/reschedule, billing, escalation.
- Narrator streaming and model-driven tool calling (single-pass generate).
- SSE parser fix for OpenRouter streaming.
- WS is authoritative for assistant output; RPC returns `{ ok, callSessionId }`.
- E2E tests updated to match new RPC response shape.
- ActionPlan schema + policy gates before tool execution.
- WS event schema with `seq`, `turnId`, `messageId`, `role`, `correlationId` and UI stitching.
- Chronological message context passed to models for better tool selection.
- Model call logging (provider/model id per generate/respond/status).
- Streaming outcome logging for narrator streams (token count, JSON guard).
- Client turn metrics with first token/status/total latency.
- Conversation summary endpoint + UI panel with markdown output.

In progress:
- First-token-fast acknowledgements before tool/model work begins.
- AI Gateway trace id logging + latency tracing per model call.
- RealtimeKit UI tab + token endpoint so verified customers can join the RTK chat.

Not started:
- RealtimeKit transcript wiring for voice.
- Prefetch strategies (appointments/slots) to reduce perceived latency.
- Documentation updates for RealtimeKit setup + transcript mapping.
 - Known issues list for RealtimeKit UI tab.

### Parallelizable workstreams
Workstream A: RealtimeKit UI + text transport (frontend)
- **Workstream A task list**
  - [x] Register the RealtimeKit loader and core UI components in the Next.js app so the `<rtk-chat>` elements can render (Web & voice share the same assets).
  - [x] Instantiate the RealtimeKit meeting that uses the chat config and render `<rtk-chat>` inside the existing chat page/layout.
  - [x] Issue RTK auth tokens from `/api/conversations/:id/rtk-token` so verified customers can join the meeting with their persistent participant id.
  - [x] Hook chat events to hit `/api/conversations/:id/message` (oRPC) and keep the doc’s task list in sync whenever we finish a step; this area is isolated to Workstream A so others can update their sections independently.
  - [x] Split classic + realtime UI into separate views so state does not leak across tabs.
  - [x] Register RealtimeKit web components with `defineCustomElements`.
  - [x] Send RealtimeKit chat updates and transcript events to the DO (typed + mic input).
  - [ ] Resolve RealtimeKit UI teardown errors during rapid tab/session switches.
  - [ ] Verify that `meeting.chat` and `meeting.participants` are always present before RTK chat mounts.
  - [ ] Confirm transcript events fire with the current preset in production.
  - [ ] Document remaining RTK UI caveats + finalize the Workstream A checklist.

Workstream B: DO streaming loop + latency (backend)
- Emit immediate narrator token on turn start (first-token-fast).
- Run tool calls concurrently with acknowledgements.
- Add per-turn timing + AI Gateway trace ids in logs.
- Ensure RPC response returns only `{ ok, callSessionId }` (no assistant text).
- Capture tool call latency + tool results in per-turn metadata for summary rendering.

Workstream C: Voice transcripts (frontend + backend)
- Use RealtimeKit `meeting.ai.on("transcript")`.
- Map partial transcripts to UI-only updates.
- Send final transcripts to DO as `final_transcript`.

Workstream D: Quality guardrails (backend)
- Tighten model prompts for verification/reschedule/schedule/confirm.
- Implement ActionPlan schema + policy gates for high‑risk actions. (done)
- Reduce robotic phrasing; ensure address-on-file confirmation before asking for new.
- Add fallback clarifications for ambiguous scheduling.
- Ensure tool-call model always returns tool calls for known intents (no "final" fallbacks).

### Milestones
M1: First-token-fast + reduced model round trips (A/B) — in progress
  - Done: remove route model call, WS authoritative output, updated e2e RPC shape.
  - Remaining: immediate ack before tool/model work, guard against JSON leakage, ensure tool-call model always returns tool calls for supported intents.
M2: RealtimeKit text chat wired to DO (A) — in progress
  - Done: register web components, init meeting, mount `<rtk-chat>`.
  - Done: bridge chat events to `/api/conversations/:id/message`.
  - Done: separate realtime UI tab state + hooks.
  - Remaining: keep realtime docs updated.
  - Remaining: resolve RTK UI teardown errors and confirm transcript events in prod.

### Known issues (RealtimeKit UI)
- RTK UI can throw `Cannot read properties of null (reading 'self')` during
  `rtk-chat` teardown when the meeting is unset quickly (likely on rapid tab or
  session switches). Need to confirm root cause and best fix.
- RTK UI can throw `Cannot read properties of undefined (reading '_events')`
  when event listeners attach before `meeting.chat` is ready. We now request
  chat/participant modules, but need to validate consistently.
- Transcript events depend on RealtimeKit preset configuration; verify the
  configured preset enables AI transcription in production.
- Reference docs for RTK UI components:
  [`docs/cloudflare/realtime-components.md`](../docs/cloudflare/realtime-components.md).
M3: Voice transcripts wired to DO (C) — not started
  - Remaining: map `meeting.ai` transcripts to DO events; use final transcript for tool calls.
M4: Quality and prompt tuning complete (D) — in progress
  - Done: narrator prompts for verification and tool responses.
  - Remaining: fix schedule vs reschedule confusion, enforce slot selection before confirm, ensure reschedule intent triggers tool calls.
M5: Diagnostics + summaries (B/D) — in progress
  - Done: per-turn client metrics + server model/tool logging.
  - Done: markdown conversation summary endpoint and UI panel.
  - Remaining: include tool latency + results in summary and align with callSessionId/turnId.
### Phase 0: decisions (locked)
- Interpreter latency targets: p50 <= 250ms, p95 <= 600ms.
- Interpreter placement: Workers AI first; fall back to OpenRouter constrained selection if latency exceeds target.
- Event schema: `token`, `status`, `final`, `error`, `resync`, `speaking`.
- Resync policy: monotonic `lastEventId` per session, replay N = 200 events.
- Storage split:
  - DO: `state`, `events`, `speaking`, `pending`.
  - D1: turns, tool calls, outcomes, summary.
- Transport: WebSocket primary for voice and web; optional SSE endpoint for web chat.

### Phase 0: decision + design
- Confirm interpreter placement (Workers AI vs OpenRouter) and target latency budget.
  - Set target p50/p95 for interpreter latency.
  - Decide fallback: OpenRouter candidate selection or heuristic-first tier.
- Decide event schema and resync payloads.
  - Freeze event types and required fields.
  - Define `lastEventId` semantics and replay limit N.
- Decide storage keys for DO state vs D1 audit records.
  - Define DO storage keys: `state`, `events`, `speaking`, `pending`.
  - Define D1 tables/columns for turn summaries, tool calls, outcomes.

### Phase 1: foundations
- Implement `ConversationSession` DO with storage-backed state.
  - New DO in `apps/worker/src/durable-objects/`.
  - State shape: `verification`, `appointments`, `pendingCancellation`, `lastEventId`.
  - Persist rolling event buffer for resync.
- Add WebSocket endpoint for streaming events and barge-in.
  - `GET /api/conversations/:id/socket` upgrades to WebSocket.
  - Server emits `event` messages; client sends `barge_in` and `final_transcript`.
- Add `POST /api/conversations/:id/message` to forward user turns.
  - Worker validates payload and forwards to DO `POST /message`.
  - Return `{ conversationId }` immediately.
- Add resync handler using `lastEventId`.
  - `POST /api/conversations/:id/resync` sends `lastEventId`.
  - DO replays last N events + `speaking` state.

### Phase 2: state machine + tools
- Extract state machine from [`agent.ts`](../apps/worker/src/use-cases/agent.ts) into DO.
  - Create `conversation-state.ts` with pure transition functions.
  - Move verification, appointment selection, and confirmation logic.
- Define state transitions and confirmation gates.
  - Enforce two-step cancellation commit.
  - Reject tool calls if verification is not complete.
- Harden tools with Zod input/output validation.
  - Add explicit schemas for `VerifyCustomer`, `ListAppointments`, `CancelAppointment`.
  - Validate tool outputs before passing to narrator.
- Store tool call snapshots in D1.
  - Add repository method `recordToolCall`.
  - Persist tool name, args hash, result summary, latency.

### Phase 3: model split
- Integrate narrator streaming model.
  - Add `respondStream` in DO loop with token events.
  - Do not parse narrator output.
- Replace deterministic reply strings with narrator outputs for appointments, billing, cancel/reschedule prompts, and escalation.
- Run verification prompts and follow-ups through narrator with friendly tone.
- Emit a narrator acknowledgement immediately, then run tool calls concurrently and append tool narration.
- Integrate interpreter model with validation.
  - Add `selectOption` with Zod validation.
  - Only call on constrained selections (confirmation, appointment choice, slot choice).
  - Add tool-calling model step to decide and validate tool invocations.
  - Add intent classification (single-pass) for primary routing; extend to multi-intent later.
- Add latency metrics and fallback path.
  - Capture per-turn `interpret_ms` and `narrate_ms`.
  - If interpreter exceeds threshold, fall back to clarification.
  - Log `first_token_ms` and `time_to_status_ms` per turn.
- Ensure schedule intent uses `getAvailableSlots` and address-on-file confirmation before asking for new addresses.
- Preserve pending intent through verification so the first post-verify response continues the original request.
- Avoid reschedule/cancel misrouting when the user is scheduling a new appointment.
- Reduce model round trips by combining routing + tool selection.
- Avoid returning assistant text in RPC responses; WS stream is authoritative.

### Phase 4: voice behaviors
- Add barge-in handling (cancel narrator + TTS).
  - On `barge_in`, set `speaking=false`, cancel stream, emit `status`.
  - Preserve state and accept next turn immediately.
- Enforce final transcript boundary before tool/interpreter calls.
  - Ignore partial transcripts except for UI display.
  - Commit tool calls only on `final_transcript`.
- Add filler status emission on timeout.
  - If no tokens emitted within 2s, emit `status: "Okay, checking."`.
- Wire RealtimeKit transcription into the session loop.
  - Use `meeting.ai.on("transcript", ...)` and map `isPartialTranscript` to `final_transcript` vs UI-only updates.
  - Configure transcription language and keywords via RealtimeKit AI config.

### Phase 5: client integration
- Update client to use WebSockets and resync on reconnect.
  - Reconnect with `lastEventId`.
  - Apply replayed events before new tokens.
- Render status + token events in order.
  - Append `token` to active assistant message.
  - Render `status` as a separate line.
- Handle barge-in and final transcript emission.
  - Send `barge_in` on user speech start.
  - Send `final_transcript` when ASR finalizes.

### Phase 6: tests + docs
- Integration tests for verify/list/cancel flows.
  - Add tests under `apps/worker/test/` with D1 fixtures.
- Unit tests for state transitions.
  - Validate each state transition and confirmation gate.
- Document DO streaming + resync protocol.
- Document RealtimeKit setup for voice sessions (transcription presets + transcript events).

## AI Gateway alignment
- Prefer AI Gateway for model observability, retries, rate limits, and provider fallbacks.
- Capture `cf-aig-eventId` or log ids (when present) for cross-provider traceability.
  - Add doc in `docs/` describing event schema and resync.

## Progress (implemented)
- [x] ConversationSession DO with WebSocket support, message/resync endpoints, and event buffering.
- [x] Worker routing for `/api/conversations/:id/{socket|message|resync}`.
- [x] State machine scaffold + summary-to-state derivation.
- [x] Verification gate with ZIP prompt + CRM verification in the DO.
- [x] Deterministic appointment listing response + state updates in the DO.
- [x] Conversational e2e tests covering verification + appointment listing.
- [x] Deterministic billing flow for open invoices with conversational e2e coverage.
- [x] Escalation flow for human handoff with conversational e2e coverage.
- [x] Admin appointment lookup to verify cancel/reschedule outcomes in e2e tests.
- [x] Conversational cancel/reschedule e2e tests validate appointment status changes.
- [x] E2E tests validate DO state via resync instead of brittle response strings.
- [x] E2E tests wait for appointment options before sending workflow selections.
- [x] DO starts cancel/reschedule workflows deterministically and ensures call sessions exist.
- [x] DO sends cancel/reschedule selection events directly (appointment/slot/confirm) for reliable e2e flows.
- [x] Turn latency logging for `first_token_ms` and `time_to_status_ms`.
- [x] Log filter helper for `callSessionId` via `bun run logs:call`.
- [x] Reschedule/cancel acknowledgements now stream appointment options in the same turn.
- [x] Workflow selection now resolves fuzzy appointment references or re-lists options before falling back.
- [x] Pre-verification intents are captured and executed immediately after ZIP verification.
- [x] Narrator-driven responses for appointment, billing, cancel/reschedule, and escalation flows.
- [x] Interpreter-driven intent classification with validated routing and selection handling.
- [x] Reschedule flow presents available slots (no raw slot ids) and uses interpreter for slot selection.
- [x] Tool-calling model now drives tool selection with validation in the session DO.
- Unit tests for state transitions and summary mapping.
- Remote-only e2e tests for message/resync and WebSocket final events.
- Resync payloads now include conversation state snapshots.
- ConversationSession accepts explicit cancellation confirmations via `confirm_cancel`.
- Minimal cancel confirmation e2e (requires `E2E_CUSTOMER_ID`, optional `E2E_ZIP`/`E2E_APPOINTMENT_ID`).
- ConversationSession can start cancel workflows via `start_cancel`.
- Admin RPC procedures for creating customers/appointments (`admin.createCustomer`, `admin.createAppointment`).
- ConversationSession now gates verification with model-generated ZIP prompts (with context/tone) and CRM verification before proceeding.

## Tests
- Integration tests for:
  - Verification flow with invalid zip.
  - Appointment listing and selection.
  - Two-step cancellation confirmation.
- Unit tests for state machine transitions.
- Tool adapter tests for error mapping and retry behavior.

## Open questions
- Do we want the interpreter model to live on Workers AI or OpenRouter?
- Should SSE stream reconnect support replays of the last N events?
- Do we need a shared "first-token" latency SLA per transport (web chat vs voice)?

## Audit findings (January 2026)

### Core design principle: Model-generated responses only
All customer-facing text must be model-generated with appropriate context and tone guidance. This includes:
- Status/acknowledgement messages ("Checking your appointments...")
- Error recovery messages
- Verification prompts
- Tool result narration
- Any other text shown to customers

**Rationale**: Hardcoded fallback text sounds robotic and cannot adapt to context. Model-generated responses can:
- Match the conversation tone (friendly, professional, apologetic)
- Reference specific customer context (name, previous statements)
- Follow tone guidance and brand voice settings
- Handle edge cases naturally

**Implementation**: Fire off model calls in parallel with main work; emit model-generated text as soon as it's available. The filler timeout (800ms → 400ms) serves only as a last-resort fallback if the model call fails entirely.

### Latency issues identified

1. **Multiple serial model calls per turn**
   - Location: `conversation-session.ts` lines 619-790
   - Flow: `emitEarlyAcknowledgement` → `handleVerificationGate` → `handleWorkflowSelection` → `handleToolCallingFlow` → `handleAgentMessage`
   - Each handler may call the model (generate/respond/status), creating a cascade of sequential calls
   - Impact: First token can be delayed 2-4 seconds when multiple model calls chain

2. **emitNarratorStatus is blocking**
   - Location: `conversation-session.ts` lines 3602-3673
   - The `model.status()` call is awaited before emitting any status text
   - This adds ~200-500ms latency per status emission
   - Recommendation: Fire off `model.status()` in parallel with verification/workflow/tool work; emit status when the model returns without blocking the main flow

3. **Filler timeout is 800ms**
   - Location: `conversation-session.ts` line 132 (`FILLER_TIMEOUT_MS`)
   - Users wait almost a full second before seeing "Okay, checking." if model is slow
   - Recommendation: Keep as backup fallback but reduce to 400-500ms; status model call should complete before this timer fires if running in parallel with main work

4. **Database I/O during message handling**
   - `getRecentMessages` fetches from D1 (lines 1182-1211)
   - `getCustomerContext` may hit D1/CRM (lines 3180-3222)
   - `ensureCallSession` creates session in D1
   - Only `handleToolCallingFlow` parallelizes pre-work (line 2083)
   - Other handlers (`handleVerificationGate`, `handleWorkflowSelection`) do not parallelize
   - Recommendation: Parallelize all DB fetches at turn start, cache aggressively

5. **narrateToolResult makes redundant model calls**
   - Location: `conversation-session.ts` lines 3244-3413
   - Calls `getModelAdapter`, `getCustomerContext`, `getRecentMessages` again even if already fetched
   - Recommendation: Pass pre-fetched data through options, avoid repeat I/O

6. **JSON detection holds back all tokens**
   - Location: `conversation-session.ts` lines 3322-3351
   - When JSON is detected in narrator output, tokens are buffered until sanitized
   - Then emitted via `emitNarratorTokens` which splits by whitespace and emits word-by-word
   - Loses streaming benefit entirely when model returns JSON wrapper
   - Recommendation: Fix model prompts to never return JSON; use JSON mode only for structured outputs

### Context and state management issues

1. **State fragmentation across three storage layers**
   - DO memory: `sessionState` with `conversation`, `pendingIntent`, workflow IDs (line 140)
   - D1 database: `SummarySnapshot` JSON in call sessions (accessed via `deps.calls.getSession`)
   - Workflow state: `cancelWorkflowId`, `rescheduleWorkflowId` in both DO and workflows
   - Recommendation: Make DO the source of truth for live state; D1 for audit only

2. **Summary sync failures are silently ignored**
   - Location: `syncConversationState` lines 862-899
   - JSON parse errors are logged but execution continues with potentially stale state
   - Can cause verification status, appointments, or workflow state to be out of sync
   - Recommendation: Fail the turn or trigger a resync when summary parse fails

3. **Pending intent restoration is fragile**
   - `pendingIntent` stored in `sessionState` (lines 91-100)
   - Executed in `handleVerificationGate` after successful ZIP verification
   - If any error occurs between capture and execution, intent is lost
   - Recommendation: Persist pending intent to D1 for durability; add explicit retry logic

4. **Cached customer context not invalidated**
   - `cachedCustomerContext` set on first fetch (line 181)
   - Never cleared if customer data changes during session
   - Could serve stale addresses or names
   - Recommendation: Add TTL or invalidate on verification

5. **Message history includes only last 8 turns**
   - Location: `getRecentMessages` line 1187
   - May lose important context in longer conversations
   - Status messages are filtered but other system messages are not
   - Recommendation: Consider dynamic window based on token budget

### Realtime API / update message issues

1. **No message update semantics in event protocol**
   - Current event structure (lines 69-80) has `messageId` but no update type
   - Events are append-only; cannot update or replace previous content
   - Recommendation: Add `updateType: 'append' | 'replace' | 'complete'` to event schema

2. **Status events don't integrate with message stream**
   - Status events (type: "status") emit as separate system messages
   - Client sees them as distinct from assistant message being built
   - Recommendation: Consider `updateType: 'status'` that augments current message

3. **Token streaming lost on JSON fallback**
   - When `waitingForJson` is true (lines 3322-3347), no tokens emit until end
   - Then `emitNarratorTokens` emits all at once, losing progressive display
   - Recommendation: Detect JSON early and switch to respond fallback immediately

4. **Missing incremental update for tool progress**
   - Tool calls emit status but don't update the current message with progress
   - User sees "Checking appointments..." but message content doesn't reflect this
   - Recommendation: Emit incremental updates with tool progress as part of message

5. **Acknowledgement and narration can race**
   - `emitEarlyAcknowledgement` runs concurrently with other handlers
   - If early ack finishes after tool narration starts, order is wrong
   - Recommendation: Sequence early ack completion before tool calls; use `messageId` to distinguish

### Specific recommendations (priority order)

**P0 - Critical latency fixes**
1. Fire off model-generated status call in parallel with main work (non-blocking)
   - Start `model.status()` immediately when turn begins
   - Continue with verification/workflow/tool work without waiting
   - Emit model-generated status text as soon as it returns
   - All status text is model-generated with context and tone guidance
2. Parallelize all DB fetches at turn start in a single `Promise.all`
3. Cache model adapter instance for session lifetime
4. Reduce `FILLER_TIMEOUT_MS` to 400ms (emergency fallback only, model should beat this)

**P1 - Context reliability**
1. Make summary parse failures fail the turn with a resync prompt
2. Add TTL (5 min) to `cachedCustomerContext`
3. Persist pending intent to D1 with explicit state machine tracking

**P2 - Streaming improvements**
1. Add `updateType` to event schema for message updates
2. Fix model prompts to return plain text only (no JSON wrapper)
3. If JSON detected in first chunk, abort stream and use `respond` fallback immediately
4. Sequence early acknowledgement to complete before tool narration begins

**P3 - Observability**
1. Log per-handler latency breakdown (verification, workflow, tool flow, agent message)
2. Track JSON fallback rate as a metric
3. Add trace ID linking all model calls in a single turn

### Implementation checklist (January 2026)

**Done:**
- [x] Audit of conversation-session.ts completed
- [x] Latency issues documented with line references
- [x] Context/state issues documented
- [x] Realtime API issues documented
- [x] CORS fix for 500 errors (`apps/worker/src/index.ts`)
- [x] Core design principle added: all customer-facing text model-generated
- [x] Removed deterministic message references from spec

**Next steps:**
- [ ] Implement non-blocking status emission (fire model.status() in parallel)
- [ ] Parallelize DB fetches at turn start
- [ ] Cache model adapter for session lifetime
- [ ] Reduce FILLER_TIMEOUT_MS to 400ms
- [ ] Add updateType to event schema
- [ ] Fix model prompts to avoid JSON output in narrator mode
- [ ] Add TTL to cachedCustomerContext

## Realtime quality requirements
- Acknowledge intent immediately with a first streamed token (e.g., “Got it — rescheduling your appointment now.”).
- Status updates are additive; they must not replace the initial acknowledgement.
- Narrator streaming continues even when the flow is workflow-driven.
- First response must stream without waiting on a second user turn.
- Tokens must stream as soon as the narrator starts; do not hold streaming for tool results.
- Track and log `first_token_ms` and `time_to_status_ms` per turn, plus an easy log filter by `callSessionId`.

## Voice requirements
### Transport
- Prefer WebSockets for bidirectional streaming.
- DO owns the call loop, barge-in, and resync.

### Barge-in
- If the user speaks while assistant audio is playing:
  - stop TTS immediately,
  - cancel narrator stream,
  - preserve state,
  - treat new utterance as the next turn.

### Turn boundaries
- Client sends partial transcripts.
- Only a final transcript event triggers tool or interpreter calls.

### Timeout policy
- If silence exceeds ~2s:
  - emit model-generated filler status (with context and tone),
  - run tool call,
  - speak result when ready.

### Reconnect replay
- Client reconnects with `lastEventId`.
- DO replays the last N events and current speaking state.
- Resync is explicit, not dependent on SSE semantics.

## Interpreter selection policy
- Prefer Workers AI for interpreter if latency is acceptable.
- Measure per-turn latency for the interpreter path.
- If Workers AI adds noticeable delay, use one of:
  - OpenRouter interpreter constrained to candidate selection with validation and clarification fallback.
  - Two-tier approach: quick heuristic first, interpreter second only when needed.

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

## Streaming requirements (must-haves)
- Acknowledgement first token is streamed for reschedule/cancel/appointments/billing intents.
- Status events are additive and never substitute for narrator text.
- Narrator streaming must work even when workflow-driven or tool results are pending.
- Per-turn latency (`first_token_ms`, `time_to_status_ms`) is logged with `callSessionId`.


## API surface
### Worker endpoints
- `GET /api/conversations/:id/socket` → WebSocket stream (authoritative).
- `GET /api/conversations/:id/stream` → SSE adapter that replays WS events.
- `POST /api/conversations/:id/message` → oRPC (send user turn).

### Durable Object endpoints
- `GET /socket` → WebSocket stream for session events (authoritative).
- `GET /stream` → SSE adapter stream.
- `POST /message` → ingest user turn, enqueue events, run state machine.

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

In progress:
- First-token-fast acknowledgements before tool/model work begins.
- AI Gateway trace id logging + latency tracing per model call.
- RealtimeKit UI tab + token endpoint so verified customers can join the RTK chat.

Not started:
- RealtimeKit transcript wiring for voice.
- Prefetch strategies (appointments/slots) to reduce perceived latency.
- Documentation updates for RealtimeKit setup + transcript mapping.

### Parallelizable workstreams
Workstream A: RealtimeKit UI + text transport (frontend)
- **Workstream A task list**
  - [x] Register the RealtimeKit loader and core UI components in the Next.js app so the `<rtk-chat>` elements can render (Web & voice share the same assets).
  - [x] Instantiate the RealtimeKit meeting that uses the chat config and render `<rtk-chat>` inside the existing chat page/layout.
  - [x] Issue RTK auth tokens from `/api/conversations/:id/rtk-token` so verified customers can join the meeting with their persistent participant id.
  - [x] Hook chat events to hit `/api/conversations/:id/message` (oRPC) and keep the doc’s task list in sync whenever we finish a step; this area is isolated to Workstream A so others can update their sections independently.

Workstream B: DO streaming loop + latency (backend)
- Emit immediate narrator token on turn start (first-token-fast).
- Run tool calls concurrently with acknowledgements.
- Add per-turn timing + AI Gateway trace ids in logs.
- Ensure RPC response returns only `{ ok, callSessionId }` (no assistant text).

Workstream C: Voice transcripts (frontend + backend)
- Use RealtimeKit `meeting.ai.on("transcript")`.
- Map partial transcripts to UI-only updates.
- Send final transcripts to DO as `final_transcript`.

Workstream D: Quality guardrails (backend)
- Tighten model prompts for verification/reschedule/schedule/confirm.
- Implement ActionPlan schema + policy gates for high‑risk actions. (done)
- Reduce robotic phrasing; ensure address-on-file confirmation before asking for new.
- Add fallback clarifications for ambiguous scheduling.

### Milestones
M1: First-token-fast + reduced model round trips (A/B) — in progress
  - Done: remove route model call, WS authoritative output, updated e2e RPC shape.
  - Remaining: immediate ack before tool/model work, guard against JSON leakage.
M2: RealtimeKit text chat wired to DO (A) — in progress
  - Done: register web components, init meeting, mount `<rtk-chat>`.
  - Done: bridge chat events to `/api/conversations/:id/message`.
  - Remaining: keep realtime docs updated.
M3: Voice transcripts wired to DO (C) — not started
  - Remaining: map `meeting.ai` transcripts to DO events; use final transcript for tool calls.
M4: Quality and prompt tuning complete (D) — in progress
  - Done: narrator prompts for verification and tool responses.
  - Remaining: reduce robotic phrasing, fix schedule vs reschedule confusion, enforce slot selection before confirm.
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
- ConversationSession now gates verification with deterministic ZIP prompts and CRM verification before model flow.

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
- Do we need a shared “first-token” latency SLA per transport (web chat vs voice)?

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
  - emit a deterministic filler status,
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

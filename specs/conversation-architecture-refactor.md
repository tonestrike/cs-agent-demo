# Conversation architecture refactor
Split conversational streaming from deterministic control work using a Worker + Durable Object session brain, with tools as the only source of business truth.

## Intent
- Make streaming feel instant while keeping verification, appointments, and cancellations correct and auditable.
- Stop relying on model JSON compliance for control flow.
- Persist per-session state so reconnects are safe and context does not reset.

## Current state
- The agent loop lives in [`agent.ts`](../apps/worker/src/use-cases/agent.ts) with a DB-backed call summary.
- Streaming is simulated in [`pestcall.ts`](../apps/worker/src/agents/pestcall.ts) and broadcast through [`conversation-hub.ts`](../apps/worker/src/durable-objects/conversation-hub.ts).
- A single model does decision + response + status, which makes control flow brittle when output is ambiguous.

## Target architecture
### Edge Worker
- Terminates HTTP, authenticates, rate limits, and routes requests.
- Exposes:
  - SSE stream endpoint for assistant output.
  - oRPC endpoint to send user turns.
- Forwards all conversation logic to a session Durable Object.

### Conversation session Durable Object
- Holds session state and dialog state machine.
- Orchestrates tool calls and model calls.
- Emits events into the client stream (token/status/final/error).
- Never performs side effects without explicit confirmation.

### Tools layer
- Deterministic adapters with Zod validation.
- Example tools:
  - `VerifyCustomer(phone, zip)`
  - `ListAppointments(customerId)`
  - `CancelAppointment(appointmentId)`
- Models do not “simulate” these results.

### Model layer (two roles)
- Narrator: streams user-facing text (no JSON).
- Interpreter: tiny structured decisions (yes/no confirmation, option selection).
- Interpreter output always validated.
- Intent routing should be model-driven (constrained schema), with deterministic fallbacks for high-risk actions.

## Conversation state machine
States (owned by code, not the model):
- `CollectingVerification`
- `VerifiedIdle`
- `PresentingAppointments`
- `PendingCancellationConfirmation`
- `Completed`

Transitions:
- `CollectingVerification` → `VerifiedIdle` after `VerifyCustomer`.
- `VerifiedIdle` → `PresentingAppointments` after `ListAppointments`.
- `PresentingAppointments` → `PendingCancellationConfirmation` after user selects.
- `PendingCancellationConfirmation` → `Completed` after confirmation + `CancelAppointment`.

## Event protocol (SSE payloads)
Event types:
- `token`: append assistant tokens.
- `status`: deterministic status text (tool progress).
- `final`: assistant message complete, includes summary metadata.
- `error`: recoverable error with safe message.

The Worker forwards the DO event stream to the client unchanged.

## API surface
### Worker endpoints
- `GET /api/conversations/:id/stream` → SSE stream (connects to DO).
- `POST /api/conversations/:id/message` → oRPC (send user turn).

### Durable Object endpoints
- `GET /stream` → SSE stream for session events.
- `POST /message` → ingest user turn, enqueue events, run state machine.

## Data and storage
- Session state in DO storage:
  - verification status, pending confirmation, cached appointments.
- Long-term audit in D1:
  - call turns, tool calls, final outcomes, and summaries.
  - Durable record for dropped voice sessions.
- Tool results stored as snapshots for replay and debugging.

## Implementation plan
1) **Create ConversationSession DO**
   - New DO class for state + SSE stream.
   - Replace or deprecate [`conversation-hub.ts`](../apps/worker/src/durable-objects/conversation-hub.ts).
2) **Worker routing**
   - Add SSE endpoint and oRPC message endpoint that proxy to DO.
   - Keep auth/rate limiting at the Worker edge.
3) **State machine extraction**
   - Move stateful logic out of [`agent.ts`](../apps/worker/src/use-cases/agent.ts) into DO.
   - Keep repositories and tool adapters in [`repositories/`](../apps/worker/src/repositories/).
4) **Tool layer hardening**
   - Define tool inputs/outputs with Zod.
   - Remove any “verification” or “appointment” claims that are not tool-backed.
5) **Model split**
   - Narrator model for streaming text.
   - Interpreter model for constrained selections only.
6) **Event stream**
   - Standardize event payloads and ensure deterministic status events.
7) **UI (Next.js)**
   - Use SSE for assistant tokens.
   - Use oRPC for `sendMessage` and initial session metadata.
8) **Docs + cleanup**
   - Update architecture docs.
   - Deprecate `agents` usage in [`pestcall.ts`](../apps/worker/src/agents/pestcall.ts) once DO is stable.

## Task breakdown
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
- Integrate interpreter model with validation.
  - Add `selectOption` with Zod validation.
  - Only call on constrained selections (confirmation, appointment choice).
- Add latency metrics and fallback path.
  - Capture per-turn `interpret_ms` and `narrate_ms`.
  - If interpreter exceeds threshold, fall back to clarification.

### Phase 4: voice behaviors
- Add barge-in handling (cancel narrator + TTS).
  - On `barge_in`, set `speaking=false`, cancel stream, emit `status`.
  - Preserve state and accept next turn immediately.
- Enforce final transcript boundary before tool/interpreter calls.
  - Ignore partial transcripts except for UI display.
  - Commit tool calls only on `final_transcript`.
- Add filler status emission on timeout.
  - If no tokens emitted within 2s, emit `status: "Okay, checking."`.

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

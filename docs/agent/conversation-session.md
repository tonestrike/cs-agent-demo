# Conversation session
The conversation session is the “brain” of a chat. It lives in a Durable Object so the session survives reconnects, and it owns the event stream you see in the UI. The key idea is simple: tools do the work, the model does the talking, and the DO keeps the state straight.

## How a turn works
When a user sends a message, the session runs a predictable flow:
- If the customer is not verified, it asks for ZIP and stops there.
- If a workflow is active (cancel/reschedule), it handles selections and confirmations first.
- Otherwise, the tool‑calling model picks the next tool.
- The tool runs deterministically.
- The narrator streams the final response from the tool result.

That keeps the interaction fast and safe: no guessing, no “maybe it cancelled,” and no lost state.

## What the session stores
The DO stores just enough to keep the dialog stable:
- Verification state and customer id.
- Cached appointment options and available slots.
- Workflow instance ids (cancel/reschedule).
- A rolling event buffer for resync.

D1 stores the long‑term summary and snapshots for audit/replay. See [`summary-state.ts`](../../apps/worker/src/conversation/summary-state.ts).

## Streaming events
The UI subscribes to the session’s stream and renders events in order:
- `token`: narrator tokens
- `status`: deterministic progress updates
- `final`: the finished assistant message
- `error`: recoverable error
- `resync`: replay marker
- `speaking`: streaming activity

See `useConversationSession` in [`use-conversation-session.ts`](../../apps/web/src/app/customer/hooks/use-conversation-session.ts) for the client‑side behavior.

## Tool calling (the main control loop)
The tool‑calling model decides “what to do next,” then the DO executes it.

- The model returns a tool name + args.
- Args are validated and normalized.
- The tool runs with real data.
- The narrator streams a response using the tool result.
- Recent turns are passed as structured messages with roles (`user`/`assistant`).

Tool schemas and validation live in [`tool-definitions.ts`](../../apps/worker/src/models/tool-definitions.ts).

## Narration
The narrator model owns the user‑facing text. That keeps tone and clarity consistent, even when the tools change.

The DO calls `respondStream()` when available to stream tokens as soon as they arrive.

## Workflows (cancel/reschedule)
Cancel and reschedule are two‑step commits:
- Select the appointment.
- Confirm the change.

Reschedule also fetches available slots and presents them before asking for confirmation. Workflow events are defined in [`workflows/constants.ts`](../../apps/worker/src/workflows/constants.ts).

## Resync
Reconnects use resync: the DO replays recent events and includes the current state snapshot so the UI can rebuild the session.

## Where the code lives
- Session brain: [`conversation-session.ts`](../../apps/worker/src/durable-objects/conversation-session.ts)
- State machine: [`state-machine.ts`](../../apps/worker/src/conversation/state-machine.ts)
- Tool schemas: [`tool-definitions.ts`](../../apps/worker/src/models/tool-definitions.ts)

## Logging
Per‑turn latency logs include `first_token_ms` and `time_to_status_ms`. Filter by session with:

```sh
bun run logs:call -- <callSessionId>
```

See [`scripts/logs-call-session.ts`](../../scripts/logs-call-session.ts) for details.

## Tests
Conversational e2e tests live under `apps/worker/src/*.e2e.test.ts`. They validate state transitions and tool effects instead of matching brittle text.

## Task list
- [ ] Route back into intent/workflow selection automatically after verification in the DO (no standalone verification reply).
- [ ] Add model-routed off-domain handling with human-offer escalation for repeated unclear turns.
- [ ] Improve DO logging and debug ergonomics (per-turn completion logs, easier filtering/fetching by session id).
- [x] Add debug endpoint to fetch session state/events by callSessionId.
- [ ] Implement real appointment management with D1 database:
  - Schedule new appointments (create in DB)
  - Reschedule existing appointments (cancel old, create new)
  - Cancel appointments (mark as canceled in DB)
  - List upcoming appointments (query from DB)

---

# ConversationSession v2

A complete rewrite of the conversation session DO with a modular, generic architecture. All domain knowledge is injected via providers, making the core session reusable across different use cases.

v1 durable object and HTTP routes have been removed from the worker config; only the v2 DO is wired (`/api/v2/conversations/:id/...`).

## Architecture

The v2 session is built from composable modules:

| Module | Purpose | File |
|--------|---------|------|
| **Session** | Coordinator, WebSocket handling, HTTP routes | [`v2/session.ts`](../../apps/worker/src/durable-objects/conversation-session/v2/session.ts) |
| **StateManager** | Load/save state, domain state updates | [`v2/state.ts`](../../apps/worker/src/durable-objects/conversation-session/v2/state.ts) |
| **EventEmitter** | Event creation, buffering, broadcasting | [`v2/events.ts`](../../apps/worker/src/durable-objects/conversation-session/v2/events.ts) |
| **ConnectionManager** | WebSocket lifecycle, message routing | [`v2/connection.ts`](../../apps/worker/src/durable-objects/conversation-session/v2/connection.ts) |

Domain logic is injected via two providers:
- **ToolProvider**: Supplies available tools and their executors based on state
- **PromptProvider**: Builds system prompts and provides the greeting

## Provider wiring

- Tool provider wraps existing tool definitions and handlers from [`tool-definitions.ts`](../../apps/worker/src/models/tool-definitions.ts) and [`tool-flow/registry.ts`](../../apps/worker/src/durable-objects/conversation-session/tool-flow/registry.ts), so v2 keeps the v1 workflow logic.
- Verification gating reads `domainState.conversation.verification.verified`; workflow gating reads `domainState.rescheduleWorkflowId`, `domainState.cancelWorkflowId`, `domainState.activeSelection`, and cached `availableSlots`.
- `buildToolFlowContext()` maps the v2 `domainState` back into the v1 conversation shape before calling handlers. Keep those keys stable when adding new domain data.

## Key differences from v1

| Aspect | v1 | v2 |
|--------|----|----|
| Domain knowledge | Hardcoded in DO | Injected via providers |
| Verification | DO handles directly | Tool (identity.verifyZip) |
| Workflows | Intercepted phases | Model calls workflow tools |
| Tool loop | Manual adapter calls | `runWithTools` from @cloudflare/ai-utils |
| State | Mixed concerns | Generic `domainState` + typed accessors |

## Current status

### Validated ✅
- **RTK token generation**: Creates/refreshes RealtimeKit participant tokens
  - Stores meetingId, participantId in domainState
  - Handles token refresh for same call session
  - Creates fresh participant for new call sessions
- **WebSocket connection**: Upgrade, message handling, resync
- **Event buffering**: Events stored for resync after reconnect
- **State persistence**: domainState survives DO hibernation
- **Greeting on connect**: Sends greeting when WebSocket connects (not on first message)
  - Tracks `greetingSent` in domainState to avoid duplicates
  - Resets when new call session detected in RTK token handler
- **Streaming responses**: `streamFinalResponse: true` enabled with proper SSE parsing
  - Uses `EventSourceParserStream` from [`eventsource-parser`](https://github.com/rexxars/eventsource-parser) for standard SSE parsing
  - Tokens emitted via `emitToken()` as they arrive
  - Full response collected for message history
- **Account verification**: `crm.verifyAccount` tool handler implemented
  - Looks up customer by phone from session context
  - Verifies ZIP code matches
  - Updates conversation state with verified status
  - Tracks failed attempts and offers escalation after 2 failures
- **Worker wiring**: `/api/conversations/:id/{socket|message|resync|rtk-token|summary|debug}` and `/api/v2/conversations/:id/{socket|message|resync|debug}` proxy to the v2 DO in [`apps/worker/src/index.ts`](../../apps/worker/src/index.ts)
- **Interruption handling (barge-in)**: User can interrupt mid-response
  - `speaking` state tracked and emitted to clients
  - `canceledStreamIds` set prevents emitting tokens after interruption
  - `barge_in` message type cancels current stream
  - New message while speaking triggers automatic barge-in
- **Tool-specific acknowledgements**: Each tool defines an `acknowledgement` message
  - See [`tool-definitions.ts`](../../apps/worker/src/models/tool-definitions.ts) for per-tool messages
  - Multiple tool prompts aggregated into single status message via model

### In progress 🔄
- *None currently*

### Not yet validated 🔲
- **Multi-tool chains**: maxRecursiveToolRuns > 1 not tested
- **Workflow completion**: Full cancel/reschedule flow through v2
- **Voice call flow**: End-to-end testing with RealtimeKit

## Greeting flow

When a WebSocket connects, the session automatically sends the greeting if not already sent:

```
WebSocket connects
    ↓
ConnectionManager.setupConnection()
    ↓
Calls connectHandler callback
    ↓
Session.handleConnect()
    ↓
Check domainState.greetingSent
    ↓
If callSessionId changed (passed on upgrade) → reset greeting/histories/workflow flags
    ↓
If false → sendGreeting()
    - Add greeting to messageHistory
    - Set domainState.greetingSent = true
    - Emit "final" event to all connections
```

The greeting is configured in `PromptProvider.getGreeting()`. Default:
> "Hi, thank you for calling PestCall! To get started, can I get your 5-digit ZIP code to verify your account?"

## Routes

Routes are served by the v2 DO and proxied under `/api/v2/conversations/:id/`:

| Method | Path | Purpose |
|--------|------|---------|
| GET | /health | Connection count, current turnId |
| GET | /state | Current session state |
| POST | /message | Process message (HTTP, for testing) |
| POST | /reset | Clear state and history |
| POST | /resync | Replay events since lastEventId |
| POST | /rtk-token | Get/refresh RealtimeKit token |
| GET | /summary | Call summary and domainState |
| GET | /debug | Full debug snapshot |

## Open issues

1. **Model not calling tools reliably**: Sometimes returns `final` when tools should be called
   - May need better system prompt tuning
   - Consider forcing tool calls for high-intent messages

2. **Fallback message timing**: "Working on that..." appears when model is slow
   - 8 second timeout may be too short for complex tool chains

3. ~~**Streaming not enabled**: Final responses are buffered, not streamed~~ DONE
   - `streamFinalResponse: true` set in runWithTools
   - Tokens streamed via `emitToken()` events

4. **Aggregated acknowledgement messages**: Generic "Working on that..." isn't helpful
   - Should aggregate context from pending tool calls
   - Example: "Looking up your appointments and checking availability..."

5. **Tool call metrics**: `toolCallCount` in `MessageResult` is hardcoded to 0; need real counts for logging/analytics.

## Turn handling details

- First tool call with an acknowledgement prompt triggers aggregation: all queued tool acknowledgement prompts are combined and fed to the model to generate a single streamed status message. If no tool provides a prompt, no acknowledgement is sent. One acknowledgement per turn; multi-step chains can add more prompts before the model fires.
- Fallback timer (8s) only fires if no acknowledgement has been sent; it emits the fallback status and prevents a later duplicate ack.
- History trims to the last 20 messages; a new callSessionId (from RTK token handler or socket upgrade) clears history, turn counter, and workflow flags so the next connect replays the greeting.

## Files

```
apps/worker/src/durable-objects/conversation-session/v2/
├── session.ts          # Main session class and builder
├── types.ts            # Type definitions
├── state.ts            # State manager
├── events.ts           # Event emitter
├── connection.ts       # WebSocket connection manager
└── providers/
    ├── prompt-provider.ts    # System prompt builder
    └── tool-provider.ts      # Tool definitions and executors
```

## Testing

Run v2 tests:
```sh
bun test apps/worker/src/durable-objects/conversation-session/v2/
```

To test voice calls:
1. Start the worker: `cd apps/worker && bun dev`
2. Call the configured phone number
3. Check logs for `session.v2.*` events
4. Use debug endpoint: `GET /api/conversations/{id}/debug`

## Future work

### Simpler prompt/config UI

The current prompt playground may be removed in favor of a simpler configuration UI:

- **Show tool prompts**: Display the acknowledgement and description for each tool
- **Greeting control**: Edit the greeting message and tone
- **Sentiment/tone settings**: Adjust agent personality without code changes
- **Protected fields**: Some config values (e.g., verification requirements, tool schemas) should not be editable at runtime

Goal: Provide non-technical users a way to tune agent behavior without touching code, while keeping safety-critical config locked down.

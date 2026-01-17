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

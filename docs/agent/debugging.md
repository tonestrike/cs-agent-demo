# Agent debugging
Practical steps to inspect live conversations when something goes wrong.

## Quick start
- Tail logs for a single call: `bun run scripts/logs-call-session.ts <callSessionId>`.
- One-shot log capture (auto-stops after 15s, pass a duration to override): `bun run scripts/logs-call-session-once.ts <callSessionId> [seconds]`.
- Snapshot the Durable Object state: `curl -H "x-demo-auth: $DEMO_TOKEN" "$WORKER_BASE/api/conversations/<callSessionId>/debug"`.
- Fetch the last summarized view: `curl -H "x-demo-auth: $DEMO_TOKEN" "$WORKER_BASE/api/conversations/<callSessionId>/summary"`.

## Useful endpoints
- `GET /api/conversations/{callSessionId}/debug` – returns the DO snapshot (`sessionState`, `eventBuffer`, `turnDecision`, `turnMetrics`, and any persisted DB session/turns). Implemented in [`conversation-session.ts`](../../apps/worker/src/durable-objects/conversation-session.ts#L357).
- `GET /api/conversations/{callSessionId}/summary` – summarized state pulled from D1 for quick recall. Same handler as above.
- `POST /api/conversations/{callSessionId}/resync` with `{ "lastEventId": <number> }` – replays buffered events and the current conversation state.

Pass the demo auth token with `x-demo-auth` (or `authorization: Bearer ...`); calls without it return 401 when `DEMO_AUTH_TOKEN` is set.

## Logs
- Stream filtered worker logs for a call session: `bun run scripts/logs-call-session.ts <callSessionId>` (wraps `wrangler tail` with a search filter).
- Capture a bounded window without keeping a terminal open: `bun run scripts/logs-call-session-once.ts <callSessionId> [seconds]`.
- Server logs to watch:
  - `conversation.session.final.empty_text` or `conversation.session.tool_call.invalid_decision` – model returned an empty/invalid decision, so the narrator fell back.
  - `openrouter.tool_call.*` / `workers_ai.tool_call.*` – shows the raw tool-call parsing result from the model adapter.

## When replies fall back to “I could not interpret…”
That line is injected when the tool-calling model returns a `final` with empty text or an invalid tool decision. See `INTERPRET_FALLBACK_TEXT` in [`conversation-session.ts`](../../apps/worker/src/durable-objects/conversation-session.ts#L83) and adapter fallbacks in [`models/openrouter.ts`](../../apps/worker/src/models/openrouter.ts#L803) and [`models/workers-ai.ts`](../../apps/worker/src/models/workers-ai.ts#L487).

Triage steps:
- Hit `/debug` for the call session and check `turnDecision` and the `debug` field on the final turn (e.g., `reason: "empty_final_text"` or `reason: "invalid_tool_decision"`).
- Tail logs for the same `callSessionId` to see the adapter-level parse failures or empty content.
- If the model sent multiple partial replies, confirm whether the UI rendered repeated `final` events from the DO or whether the model streamed multiple final chunks (check `eventBuffer` and `turnMetrics`).

## Artifacts to capture for investigations
- `callSessionId`
- `/debug` snapshot JSON
- Tail logs for the same session (`bun run scripts/logs-call-session.ts ...`)
- The user’s input text and phone for CRM lookup context (E164)

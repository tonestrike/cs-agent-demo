# Agent debugging
Practical steps to inspect live conversations when something goes wrong.

## Quick start
- Tail logs for a single call: `bun run scripts/logs-call-session.ts <callSessionId>`.
- Snapshot the Durable Object state: `curl -H "x-demo-auth: $DEMO_TOKEN" "$WORKER_BASE/api/conversations/<callSessionId>/debug"`.
- Fetch the last summarized view: `curl -H "x-demo-auth: $DEMO_TOKEN" "$WORKER_BASE/api/conversations/<callSessionId>/summary"`.
- Query the D1 call record (remote): `wrangler d1 execute pestcall_local --remote --config apps/worker/wrangler.toml --command "SELECT id, started_at, status FROM call_sessions WHERE id = '<callSessionId>';"`.
- Query the D1 call turns: `wrangler d1 execute pestcall_local --remote --config apps/worker/wrangler.toml --command "SELECT speaker, ts, text FROM call_turns WHERE call_session_id = '<callSessionId>' ORDER BY ts;"`.

## Useful endpoints
- `GET /api/conversations/{callSessionId}/debug` – returns the DO snapshot (`sessionState`, `eventBuffer`, `turnDecision`, `turnMetrics`, and any persisted DB session/turns). Implemented in [`conversation-session.ts`](../../apps/worker/src/durable-objects/conversation-session.ts#L357).
- `GET /api/conversations/{callSessionId}/summary` – summarized state pulled from D1 for quick recall. Same handler as above.
- `POST /api/conversations/{callSessionId}/resync` with `{ "lastEventId": <number> }` – replays buffered events and the current conversation state.

Pass the demo auth token with `x-demo-auth` (or `authorization: Bearer ...`); calls without it return 401 when `DEMO_AUTH_TOKEN` is set.

## Logs
- Stream filtered worker logs for a call session: `bun run scripts/logs-call-session.ts <callSessionId>` (wraps `wrangler tail` with a search filter).
- Server logs to watch:
  - `conversation.session.final.empty_text` or `conversation.session.tool_call.invalid_decision` – model returned an empty/invalid decision, so the narrator fell back.
  - `openrouter.tool_call.*` / `workers_ai.tool_call.*` – shows the raw tool-call parsing result from the model adapter.

## When replies fall back to “I could not interpret…”
That line is injected when the tool-calling model returns a `final` with empty text or an invalid tool decision. See `INTERPRET_FALLBACK_TEXT` in [`conversation-session.ts`](../../apps/worker/src/durable-objects/conversation-session.ts#L83) and adapter fallbacks in [`models/openrouter.ts`](../../apps/worker/src/models/openrouter.ts#L803) and [`models/workers-ai.ts`](../../apps/worker/src/models/workers-ai.ts#L487).

Triage steps:
- Hit `/debug` for the call session and check `turnDecision` and the `debug` field on the final turn (e.g., `reason: "empty_final_text"` or `reason: "invalid_tool_decision"`).
- Tail logs for the same `callSessionId` to see the adapter-level parse failures or empty content.
- If the model sent multiple partial replies, confirm whether the UI rendered repeated `final` events from the DO or whether the model streamed multiple final chunks (check `eventBuffer` and `turnMetrics`).

## Datastores to inspect
- **Durable Object state**: `/api/conversations/{callSessionId}/debug` includes `sessionState`, `turnDecision`, `turnMetrics`, and the recent `eventBuffer`.
- **D1 (call history)**: tables `call_sessions` (metadata/summary) and `call_turns` (per utterance, with `meta_json`). Query via Wrangler (uses the database name `pestcall_local` from `apps/worker/wrangler.toml`):
  - Single session: `wrangler d1 execute pestcall_local --remote --config apps/worker/wrangler.toml --command "SELECT * FROM call_sessions WHERE id = '<callSessionId>';"`.
  - Turns: `wrangler d1 execute pestcall_local --remote --config apps/worker/wrangler.toml --command "SELECT speaker, ts, text, meta_json FROM call_turns WHERE call_session_id = '<callSessionId>' ORDER BY ts;"`.
  - Local dev data: drop `--remote` to hit the Miniflare DB (`wrangler dev --local` uses the same `pestcall_local` name). Wrangler stores the local SQLite under `.wrangler/state` if you need to open it directly.
  - Each agent turn’s `meta_json` now includes `modelMessages` and `modelContext` captured right before the model generate call, so you can verify the exact conversation history the model saw.
- **CRM cache**: `customers_cache` caches phone/name/ZIP lookups. Join via the session: `SELECT * FROM customers_cache WHERE id = (SELECT customer_cache_id FROM call_sessions WHERE id = '<callSessionId>');`.

## Artifacts to capture for investigations
- `callSessionId`
- `/debug` snapshot JSON
- D1 rows for `call_sessions` and `call_turns` for the same id
- Tail logs for the session (`bun run scripts/logs-call-session.ts ...`)
- The user’s input text and phone for CRM lookup context (E164)

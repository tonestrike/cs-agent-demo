import {
  type CallSessionRow,
  type CallTurnRow,
  mapCallSessionRow,
  mapCallTurnRow,
} from "../db/mappers";

export const createCallRepository = (db: D1Database) => {
  return {
    async list(params: {
      limit?: number;
      cursor?: string;
    }) {
      const limit = params.limit ?? 50;
      const queryParams: unknown[] = [];
      const conditions: string[] = [];

      if (params.cursor) {
        conditions.push("started_at < ?");
        queryParams.push(params.cursor);
      }

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const sql = `SELECT * FROM call_sessions ${whereClause} ORDER BY started_at DESC LIMIT ?`;

      const result = await db
        .prepare(sql)
        .bind(...queryParams, limit + 1)
        .all<CallSessionRow>();

      const rows = result.results ?? [];
      const trimmed = rows.slice(0, limit);
      const nextCursor =
        rows.length > limit ? (rows[limit]?.started_at ?? null) : null;

      return {
        items: trimmed.map(mapCallSessionRow),
        nextCursor,
      };
    },
    async get(callSessionId: string) {
      const session = await db
        .prepare("SELECT * FROM call_sessions WHERE id = ?")
        .bind(callSessionId)
        .first<CallSessionRow>();

      if (!session) {
        return null;
      }

      const turnsResult = await db
        .prepare(
          "SELECT * FROM call_turns WHERE call_session_id = ? ORDER BY ts ASC",
        )
        .bind(callSessionId)
        .all<CallTurnRow>();

      return {
        session: mapCallSessionRow(session),
        turns: (turnsResult.results ?? []).map(mapCallTurnRow),
      };
    },
    async createSession(input: {
      id: string;
      startedAt: string;
      phoneE164: string;
      customerCacheId?: string | null;
      status: string;
      transport: string;
      summary?: string | null;
    }) {
      await db
        .prepare(
          "INSERT INTO call_sessions (id, started_at, ended_at, phone_e164, customer_cache_id, status, transport, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          input.id,
          input.startedAt,
          null,
          input.phoneE164,
          input.customerCacheId ?? null,
          input.status,
          input.transport,
          input.summary ?? null,
        )
        .run();
    },
    async updateSessionSummary(input: {
      callSessionId: string;
      summary: string;
    }) {
      await db
        .prepare("UPDATE call_sessions SET summary = ? WHERE id = ?")
        .bind(input.summary, input.callSessionId)
        .run();
    },
    async getSession(callSessionId: string) {
      const session = await db
        .prepare("SELECT * FROM call_sessions WHERE id = ?")
        .bind(callSessionId)
        .first<CallSessionRow>();

      return session ? mapCallSessionRow(session) : null;
    },
    async addTurn(input: {
      id: string;
      callSessionId: string;
      ts: string;
      speaker: string;
      text: string;
      meta: Record<string, unknown>;
    }) {
      await db
        .prepare(
          "INSERT INTO call_turns (id, call_session_id, ts, speaker, text, meta_json) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          input.id,
          input.callSessionId,
          input.ts,
          input.speaker,
          input.text,
          JSON.stringify(input.meta),
        )
        .run();
    },
    async getRecentTurns(input: { callSessionId: string; limit?: number }) {
      const limit = input.limit ?? 6;
      const result = await db
        .prepare(
          "SELECT * FROM call_turns WHERE call_session_id = ? ORDER BY ts DESC LIMIT ?",
        )
        .bind(input.callSessionId, limit)
        .all<CallTurnRow>();

      return (result.results ?? []).map(mapCallTurnRow).reverse();
    },
    async getTurns(callSessionId: string) {
      const result = await db
        .prepare(
          "SELECT * FROM call_turns WHERE call_session_id = ? ORDER BY ts ASC",
        )
        .bind(callSessionId)
        .all<CallTurnRow>();

      return (result.results ?? []).map(mapCallTurnRow);
    },
  };
};

import {
  type CallSessionRow,
  type CallTurnRow,
  mapCallSessionRow,
  mapCallTurnRow,
} from "../db/mappers";

import type {
  CallDetail,
  CallRepository,
  CallSession,
  ListResult,
} from "./types";

export const createCallRepository = (db: D1Database): CallRepository => {
  return {
    async list(params: {
      limit?: number;
      cursor?: string;
    }): Promise<ListResult<CallSession>> {
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
    async get(callSessionId: string): Promise<CallDetail | null> {
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
  };
};

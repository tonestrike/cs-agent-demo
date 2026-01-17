import {
  type CallSessionRow,
  type CallTurnRow,
  mapCallSessionRow,
  mapCallTurnRow,
} from "../db/mappers";
import type { Logger } from "../logger";

export const createCallRepository = (db: D1Database, logger: Logger) => {
  return {
    async list(params: {
      limit?: number;
      cursor?: string;
      phoneE164?: string;
      customerCacheId?: string;
    }) {
      const limit = params.limit ?? 50;
      const queryParams: unknown[] = [];
      const conditions: string[] = [];

      if (params.phoneE164) {
        conditions.push("call_sessions.phone_e164 = ?");
        queryParams.push(params.phoneE164);
      }

      if (params.customerCacheId) {
        conditions.push("call_sessions.customer_cache_id = ?");
        queryParams.push(params.customerCacheId);
      }

      if (params.cursor) {
        conditions.push("call_sessions.started_at < ?");
        queryParams.push(params.cursor);
      }

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const sql = `
        SELECT
          call_sessions.*,
          customers_cache.id AS customer_id,
          customers_cache.phone_e164 AS customer_phone_e164,
          customers_cache.crm_customer_id AS customer_crm_id,
          customers_cache.display_name AS customer_display_name,
          customers_cache.address_summary AS customer_address_summary,
          customers_cache.zip_code AS customer_zip_code,
          customers_cache.updated_at AS customer_updated_at
        FROM call_sessions
        LEFT JOIN customers_cache
          ON customers_cache.id = call_sessions.customer_cache_id
        ${whereClause}
        ORDER BY call_sessions.started_at DESC
        LIMIT ?
      `;

      const result = await db
        .prepare(sql)
        .bind(...queryParams, limit + 1)
        .all<CallSessionRow>();

      const rows = result.results ?? [];
      const trimmed = rows.slice(0, limit);
      const nextCursor =
        rows.length > limit ? (rows[limit]?.started_at ?? null) : null;

      return {
        items: trimmed.map((row) => mapCallSessionRow(row, logger)),
        nextCursor,
      };
    },
    async get(callSessionId: string) {
      const session = await db
        .prepare(
          `
          SELECT
            call_sessions.*,
            customers_cache.id AS customer_id,
            customers_cache.phone_e164 AS customer_phone_e164,
            customers_cache.crm_customer_id AS customer_crm_id,
            customers_cache.display_name AS customer_display_name,
            customers_cache.address_summary AS customer_address_summary,
            customers_cache.zip_code AS customer_zip_code,
            customers_cache.updated_at AS customer_updated_at
          FROM call_sessions
          LEFT JOIN customers_cache
            ON customers_cache.id = call_sessions.customer_cache_id
          WHERE call_sessions.id = ?
          `,
        )
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
        session: mapCallSessionRow(session, logger),
        turns: (turnsResult.results ?? []).map((row) =>
          mapCallTurnRow(row, logger),
        ),
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
    async updateSessionCustomer(input: {
      callSessionId: string;
      customerCacheId: string;
    }) {
      await db
        .prepare("UPDATE call_sessions SET customer_cache_id = ? WHERE id = ?")
        .bind(input.customerCacheId, input.callSessionId)
        .run();
    },
    async getSession(callSessionId: string) {
      const session = await db
        .prepare(
          `
          SELECT
            call_sessions.*,
            customers_cache.id AS customer_id,
            customers_cache.phone_e164 AS customer_phone_e164,
            customers_cache.crm_customer_id AS customer_crm_id,
            customers_cache.display_name AS customer_display_name,
            customers_cache.address_summary AS customer_address_summary,
            customers_cache.updated_at AS customer_updated_at
          FROM call_sessions
          LEFT JOIN customers_cache
            ON customers_cache.id = call_sessions.customer_cache_id
          WHERE call_sessions.id = ?
          `,
        )
        .bind(callSessionId)
        .first<CallSessionRow>();

      return session ? mapCallSessionRow(session, logger) : null;
    },
    async findSessionByTicketId(ticketId: string) {
      const row = await db
        .prepare(
          "SELECT call_session_id FROM call_turns WHERE json_extract(meta_json, '$.ticketId') = ? ORDER BY ts DESC LIMIT 1",
        )
        .bind(ticketId)
        .first<{ call_session_id: string }>();

      return row?.call_session_id ?? null;
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
          "SELECT * FROM call_turns WHERE call_session_id = ? ORDER BY ts DESC, id DESC LIMIT ?",
        )
        .bind(input.callSessionId, limit)
        .all<CallTurnRow>();

      return (result.results ?? [])
        .map((row) => mapCallTurnRow(row, logger))
        .reverse();
    },
    async getTurns(callSessionId: string) {
      const result = await db
        .prepare(
          "SELECT * FROM call_turns WHERE call_session_id = ? ORDER BY ts ASC",
        )
        .bind(callSessionId)
        .all<CallTurnRow>();

      return (result.results ?? []).map((row) => mapCallTurnRow(row, logger));
    },
    async getLatestAgentTurn(callSessionId: string) {
      const row = await db
        .prepare(
          "SELECT * FROM call_turns WHERE call_session_id = ? AND speaker = 'agent' ORDER BY ts DESC LIMIT 1",
        )
        .bind(callSessionId)
        .first<CallTurnRow>();

      return row ? mapCallTurnRow(row, logger) : null;
    },
  };
};

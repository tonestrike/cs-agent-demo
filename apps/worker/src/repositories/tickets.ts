import type { Ticket, TicketEvent, TicketStatus } from "@pestcall/core";

import {
  type TicketEventRow,
  type TicketRow,
  mapTicketEventRow,
  mapTicketRow,
} from "../db/mappers";

type TicketRowResult = TicketRow & { status: TicketStatus };

type TicketEventInput = {
  ticketId: string;
  type: TicketEvent["type"];
  payload: Record<string, unknown>;
  timestamp: string;
};

export const createTicketRepository = (db: D1Database) => {
  return {
    async list(params: {
      status?: TicketStatus;
      q?: string;
      customerCacheId?: string;
      phoneE164?: string;
      limit?: number;
      cursor?: string;
    }) {
      const limit = params.limit ?? 50;
      const queryParams: unknown[] = [];
      const conditions: string[] = [];

      if (params.status) {
        conditions.push("status = ?");
        queryParams.push(params.status);
      }

      if (params.q) {
        conditions.push("(subject LIKE ? OR description LIKE ?)");
        queryParams.push(`%${params.q}%`, `%${params.q}%`);
      }

      if (params.customerCacheId) {
        conditions.push("customer_cache_id = ?");
        queryParams.push(params.customerCacheId);
      }

      if (params.phoneE164) {
        conditions.push("phone_e164 = ?");
        queryParams.push(params.phoneE164);
      }

      if (params.cursor) {
        conditions.push("created_at < ?");
        queryParams.push(params.cursor);
      }

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const sql = `SELECT * FROM tickets ${whereClause} ORDER BY created_at DESC LIMIT ?`;

      const result = await db
        .prepare(sql)
        .bind(...queryParams, limit + 1)
        .all<TicketRowResult>();

      const rows = result.results ?? [];
      const trimmed = rows.slice(0, limit);
      const nextCursor =
        rows.length > limit ? (rows[limit]?.created_at ?? null) : null;

      return {
        items: trimmed.map(mapTicketRow),
        nextCursor,
      };
    },
    async get(ticketId: string) {
      const row = await db
        .prepare("SELECT * FROM tickets WHERE id = ?")
        .bind(ticketId)
        .first<TicketRowResult>();

      return row ? mapTicketRow(row) : null;
    },
    async insert(ticket: Ticket) {
      await db
        .prepare(
          "INSERT INTO tickets (id, created_at, updated_at, status, priority, category, customer_cache_id, phone_e164, subject, description, assignee, source, external_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          ticket.id,
          ticket.createdAt,
          ticket.updatedAt,
          ticket.status,
          ticket.priority,
          ticket.category,
          ticket.customerCacheId ?? null,
          ticket.phoneE164 ?? null,
          ticket.subject,
          ticket.description,
          ticket.assignee ?? null,
          ticket.source,
          ticket.externalRef ?? null,
        )
        .run();
    },
    async addEvent(input: TicketEventInput) {
      const eventId = crypto.randomUUID();
      await db
        .prepare(
          "INSERT INTO ticket_events (id, ticket_id, ts, type, payload_json) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(
          eventId,
          input.ticketId,
          input.timestamp,
          input.type,
          JSON.stringify(input.payload),
        )
        .run();

      const row: TicketEventRow = {
        id: eventId,
        ticket_id: input.ticketId,
        ts: input.timestamp,
        type: input.type,
        payload_json: JSON.stringify(input.payload),
      };

      return mapTicketEventRow(row);
    },
    async updateStatus(input: {
      ticketId: string;
      status: TicketStatus;
      updatedAt: string;
    }) {
      await db
        .prepare("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?")
        .bind(input.status, input.updatedAt, input.ticketId)
        .run();
    },
  };
};

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
        conditions.push("tickets.status = ?");
        queryParams.push(params.status);
      }

      if (params.q) {
        conditions.push(
          "(tickets.subject LIKE ? OR tickets.description LIKE ?)",
        );
        queryParams.push(`%${params.q}%`, `%${params.q}%`);
      }

      if (params.customerCacheId) {
        conditions.push("tickets.customer_cache_id = ?");
        queryParams.push(params.customerCacheId);
      }

      if (params.phoneE164) {
        conditions.push("tickets.phone_e164 = ?");
        queryParams.push(params.phoneE164);
      }

      if (params.cursor) {
        conditions.push("tickets.created_at < ?");
        queryParams.push(params.cursor);
      }

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const sql = `
        SELECT
          tickets.*,
          customers_cache.id AS customer_id,
          customers_cache.phone_e164 AS customer_phone_e164,
          customers_cache.crm_customer_id AS customer_crm_id,
          customers_cache.display_name AS customer_display_name,
          customers_cache.address_summary AS customer_address_summary,
          customers_cache.zip_code AS customer_zip_code,
          customers_cache.updated_at AS customer_updated_at
        FROM tickets
        LEFT JOIN customers_cache
          ON customers_cache.id = tickets.customer_cache_id
        ${whereClause}
        ORDER BY tickets.created_at DESC
        LIMIT ?
      `;

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
        .prepare(
          `
          SELECT
            tickets.*,
            customers_cache.id AS customer_id,
            customers_cache.phone_e164 AS customer_phone_e164,
            customers_cache.crm_customer_id AS customer_crm_id,
            customers_cache.display_name AS customer_display_name,
            customers_cache.address_summary AS customer_address_summary,
            customers_cache.zip_code AS customer_zip_code,
            customers_cache.updated_at AS customer_updated_at
          FROM tickets
          LEFT JOIN customers_cache
            ON customers_cache.id = tickets.customer_cache_id
          WHERE tickets.id = ?
          `,
        )
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

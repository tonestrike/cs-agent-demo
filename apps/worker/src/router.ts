import { os, ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  type Ticket,
  type TicketEvent,
  type TicketEventType,
  type TicketStatus,
  applyStatusTransition,
  createTicket,
} from "@pestcall/core";

export type Env = {
  DB: D1Database;
  DEMO_AUTH_TOKEN?: string;
};

type RequestContext = {
  env: Env;
  headers: Headers;
};

const base = os.$context<RequestContext>();

const requireAuth = base.middleware(async ({ context, next }) => {
  const expected = context.env.DEMO_AUTH_TOKEN;
  if (!expected) {
    return next();
  }

  const provided =
    context.headers.get("x-demo-auth") ??
    context.headers.get("authorization")?.replace("Bearer ", "");

  if (provided && provided === expected) {
    return next();
  }

  throw new ORPCError("UNAUTHORIZED", {
    message: "Missing or invalid demo auth token",
  });
});

const authed = base.use(requireAuth);

const ticketStatusSchema = z.enum(["open", "in_progress", "resolved"]);
const ticketPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const ticketCategorySchema = z.enum([
  "appointment",
  "billing",
  "service",
  "general",
  "unknown",
]);
const ticketSourceSchema = z.enum(["agent", "phone", "web", "internal"]);

const ticketOutputSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: ticketStatusSchema,
  priority: ticketPrioritySchema,
  category: ticketCategorySchema,
  customerCacheId: z.string().optional(),
  phoneE164: z.string().optional(),
  subject: z.string(),
  description: z.string(),
  assignee: z.string().optional(),
  source: ticketSourceSchema,
  externalRef: z.string().optional(),
});

const listTicketsInputSchema = z.object({
  status: ticketStatusSchema.optional(),
  q: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

const listTicketsOutputSchema = z.object({
  items: z.array(ticketOutputSchema),
  nextCursor: z.string().nullable(),
});

const createTicketInputSchema = z.object({
  subject: z.string().min(1),
  description: z.string().min(1),
  priority: ticketPrioritySchema.optional(),
  category: ticketCategorySchema.optional(),
  customerCacheId: z.string().optional(),
  phoneE164: z.string().optional(),
  assignee: z.string().optional(),
  source: ticketSourceSchema.optional(),
  externalRef: z.string().optional(),
});

const ticketIdInputSchema = z.object({
  ticketId: z.string().min(1),
});

const ticketEventInputSchema = z.object({
  ticketId: z.string().min(1),
  type: z.enum([
    "created",
    "status_changed",
    "note_added",
    "assignment_changed",
  ]),
  payload: z.record(z.unknown()),
});

const ticketStatusUpdateSchema = z.object({
  ticketId: z.string().min(1),
  status: ticketStatusSchema,
});

const listCallsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

const callSessionOutputSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  phoneE164: z.string(),
  customerCacheId: z.string().nullable(),
  status: z.string(),
  transport: z.string(),
  summary: z.string().nullable(),
});

const callTurnOutputSchema = z.object({
  id: z.string(),
  callSessionId: z.string(),
  ts: z.string(),
  speaker: z.string(),
  text: z.string(),
  meta: z.record(z.unknown()),
});

const callDetailOutputSchema = z.object({
  session: callSessionOutputSchema,
  turns: z.array(callTurnOutputSchema),
});

type TicketRow = {
  id: string;
  created_at: string;
  updated_at: string;
  status: TicketStatus;
  priority: Ticket["priority"];
  category: Ticket["category"];
  customer_cache_id: string | null;
  phone_e164: string | null;
  subject: string;
  description: string;
  assignee: string | null;
  source: Ticket["source"];
  external_ref: string | null;
};

type TicketEventRow = {
  id: string;
  ticket_id: string;
  ts: string;
  type: TicketEventType;
  payload_json: string;
};

type CallSessionRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  phone_e164: string;
  customer_cache_id: string | null;
  status: string;
  transport: string;
  summary: string | null;
};

type CallTurnRow = {
  id: string;
  call_session_id: string;
  ts: string;
  speaker: string;
  text: string;
  meta_json: string;
};

const mapTicketRow = (row: TicketRow): Ticket => {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    priority: row.priority,
    category: row.category,
    customerCacheId: row.customer_cache_id ?? undefined,
    phoneE164: row.phone_e164 ?? undefined,
    subject: row.subject,
    description: row.description,
    assignee: row.assignee ?? undefined,
    source: row.source,
    externalRef: row.external_ref ?? undefined,
  };
};

const safeJsonParse = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
};

const mapTicketEventRow = (row: TicketEventRow): TicketEvent => {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    ts: row.ts,
    type: row.type,
    payload: safeJsonParse(row.payload_json),
  };
};

const mapCallSessionRow = (row: CallSessionRow) => {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    phoneE164: row.phone_e164,
    customerCacheId: row.customer_cache_id ?? null,
    status: row.status,
    transport: row.transport,
    summary: row.summary ?? null,
  };
};

const mapCallTurnRow = (row: CallTurnRow) => {
  return {
    id: row.id,
    callSessionId: row.call_session_id,
    ts: row.ts,
    speaker: row.speaker,
    text: row.text,
    meta: safeJsonParse(row.meta_json),
  };
};

const ticketProcedures = {
  list: authed
    .input(listTicketsInputSchema)
    .output(listTicketsOutputSchema)
    .handler(async ({ input, context }) => {
      const limit = input.limit ?? 50;
      const params: unknown[] = [];
      const conditions: string[] = [];

      if (input.status) {
        conditions.push("status = ?");
        params.push(input.status);
      }

      if (input.q) {
        conditions.push("(subject LIKE ? OR description LIKE ?)");
        params.push(`%${input.q}%`, `%${input.q}%`);
      }

      if (input.cursor) {
        conditions.push("created_at < ?");
        params.push(input.cursor);
      }

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const sql = `SELECT * FROM tickets ${whereClause} ORDER BY created_at DESC LIMIT ?`;

      const result = await context.env.DB.prepare(sql)
        .bind(...params, limit + 1)
        .all<TicketRow>();

      const rows = result.results ?? [];
      const trimmed = rows.slice(0, limit);
      const nextCursor =
        rows.length > limit ? (rows[limit]?.created_at ?? null) : null;

      return {
        items: trimmed.map(mapTicketRow),
        nextCursor,
      };
    }),
  get: authed
    .input(ticketIdInputSchema)
    .output(ticketOutputSchema)
    .handler(async ({ input, context }) => {
      const row = await context.env.DB.prepare(
        "SELECT * FROM tickets WHERE id = ?",
      )
        .bind(input.ticketId)
        .first<TicketRow>();

      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Ticket not found" });
      }

      return mapTicketRow(row);
    }),
  create: authed
    .input(createTicketInputSchema)
    .output(ticketOutputSchema)
    .handler(async ({ input, context }) => {
      const now = new Date().toISOString();
      const ticket = createTicket({
        id: crypto.randomUUID(),
        createdAt: now,
        subject: input.subject,
        description: input.description,
        priority: input.priority,
        category: input.category,
        customerCacheId: input.customerCacheId,
        phoneE164: input.phoneE164,
        assignee: input.assignee,
        source: input.source ?? "agent",
        externalRef: input.externalRef,
      });

      await context.env.DB.prepare(
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

      const eventId = crypto.randomUUID();
      await context.env.DB.prepare(
        "INSERT INTO ticket_events (id, ticket_id, ts, type, payload_json) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(eventId, ticket.id, now, "created", JSON.stringify({}))
        .run();

      return ticket;
    }),
  addEvent: authed
    .input(ticketEventInputSchema)
    .handler(async ({ input, context }) => {
      const now = new Date().toISOString();
      const eventId = crypto.randomUUID();
      await context.env.DB.prepare(
        "INSERT INTO ticket_events (id, ticket_id, ts, type, payload_json) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(
          eventId,
          input.ticketId,
          now,
          input.type,
          JSON.stringify(input.payload),
        )
        .run();

      const row: TicketEventRow = {
        id: eventId,
        ticket_id: input.ticketId,
        ts: now,
        type: input.type,
        payload_json: JSON.stringify(input.payload),
      };

      return mapTicketEventRow(row);
    }),
  setStatus: authed
    .input(ticketStatusUpdateSchema)
    .output(ticketOutputSchema)
    .handler(async ({ input, context }) => {
      const row = await context.env.DB.prepare(
        "SELECT * FROM tickets WHERE id = ?",
      )
        .bind(input.ticketId)
        .first<TicketRow>();

      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "Ticket not found" });
      }

      const ticket = mapTicketRow(row);
      const now = new Date().toISOString();
      const transition = applyStatusTransition(ticket, input.status, now);
      if (!transition.ok) {
        throw new ORPCError("BAD_REQUEST", { message: transition.error });
      }

      await context.env.DB.prepare(
        "UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?",
      )
        .bind(transition.ticket.status, transition.ticket.updatedAt, ticket.id)
        .run();

      const eventId = crypto.randomUUID();
      await context.env.DB.prepare(
        "INSERT INTO ticket_events (id, ticket_id, ts, type, payload_json) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(
          eventId,
          ticket.id,
          now,
          "status_changed",
          JSON.stringify({
            from: ticket.status,
            to: transition.ticket.status,
          }),
        )
        .run();

      return transition.ticket;
    }),
};

const callProcedures = {
  list: authed
    .input(listCallsInputSchema)
    .output(
      z.object({
        items: z.array(callSessionOutputSchema),
        nextCursor: z.string().nullable(),
      }),
    )
    .handler(async ({ input, context }) => {
      const limit = input.limit ?? 50;
      const params: unknown[] = [];
      const conditions: string[] = [];

      if (input.cursor) {
        conditions.push("started_at < ?");
        params.push(input.cursor);
      }

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const sql = `SELECT * FROM call_sessions ${whereClause} ORDER BY started_at DESC LIMIT ?`;

      const result = await context.env.DB.prepare(sql)
        .bind(...params, limit + 1)
        .all<CallSessionRow>();

      const rows = result.results ?? [];
      const trimmed = rows.slice(0, limit);
      const nextCursor =
        rows.length > limit ? (rows[limit]?.started_at ?? null) : null;

      return {
        items: trimmed.map(mapCallSessionRow),
        nextCursor,
      };
    }),
  get: authed
    .input(z.object({ callSessionId: z.string().min(1) }))
    .output(callDetailOutputSchema)
    .handler(async ({ input, context }) => {
      const session = await context.env.DB.prepare(
        "SELECT * FROM call_sessions WHERE id = ?",
      )
        .bind(input.callSessionId)
        .first<CallSessionRow>();

      if (!session) {
        throw new ORPCError("NOT_FOUND", { message: "Call session not found" });
      }

      const turnsResult = await context.env.DB.prepare(
        "SELECT * FROM call_turns WHERE call_session_id = ? ORDER BY ts ASC",
      )
        .bind(input.callSessionId)
        .all<CallTurnRow>();

      return {
        session: mapCallSessionRow(session),
        turns: (turnsResult.results ?? []).map(mapCallTurnRow),
      };
    }),
};

export const router = {
  tickets: ticketProcedures,
  calls: callProcedures,
};

import type {
  ServiceAppointment,
  Ticket,
  TicketEvent,
  TicketEventTypeValue,
  TicketStatus,
} from "@pestcall/core";

export type TicketRow = {
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

export type TicketEventRow = {
  id: string;
  ticket_id: string;
  ts: string;
  type: TicketEventTypeValue;
  payload_json: string;
};

export type CallSessionRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  phone_e164: string;
  customer_cache_id: string | null;
  status: string;
  transport: string;
  summary: string | null;
};

export type CallTurnRow = {
  id: string;
  call_session_id: string;
  ts: string;
  speaker: string;
  text: string;
  meta_json: string;
};

export type AppointmentRow = {
  id: string;
  customer_id: string;
  phone_e164: string;
  address_summary: string;
  date: string;
  time_window: string;
  status: ServiceAppointment["status"];
  rescheduled_from_id: string | null;
  rescheduled_to_id: string | null;
  created_at: string;
  updated_at: string;
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

export const mapTicketRow = (row: TicketRow): Ticket => {
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

export const mapTicketEventRow = (row: TicketEventRow): TicketEvent => {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    ts: row.ts,
    type: row.type,
    payload: safeJsonParse(row.payload_json),
  };
};

export const mapCallSessionRow = (row: CallSessionRow) => {
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

export const mapCallTurnRow = (row: CallTurnRow) => {
  return {
    id: row.id,
    callSessionId: row.call_session_id,
    ts: row.ts,
    speaker: row.speaker,
    text: row.text,
    meta: safeJsonParse(row.meta_json),
  };
};

export const mapAppointmentRow = (row: AppointmentRow): ServiceAppointment => {
  return {
    id: row.id,
    customerId: row.customer_id,
    phoneE164: row.phone_e164,
    addressSummary: row.address_summary,
    date: row.date,
    timeWindow: row.time_window,
    status: row.status,
    rescheduledFromId: row.rescheduled_from_id ?? undefined,
    rescheduledToId: row.rescheduled_to_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

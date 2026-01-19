import type {
  CustomerCache,
  ServiceAppointment,
  Ticket,
  TicketEvent,
  TicketEventTypeValue,
  TicketStatus,
} from "@pestcall/core";
import type { Logger } from "../logger";

type JoinedCustomerRow = {
  customer_id?: string | null;
  customer_join_id?: string | null;
  customer_phone_e164?: string | null;
  customer_crm_id?: string | null;
  customer_display_name?: string | null;
  customer_address_summary?: string | null;
  customer_zip_code?: string | null;
  customer_participant_id?: string | null;
  customer_updated_at?: string | null;
};

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
} & JoinedCustomerRow;

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
} & JoinedCustomerRow;

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
} & JoinedCustomerRow;

export type CustomerCacheRow = {
  id: string;
  phone_e164: string;
  crm_customer_id: string;
  display_name: string;
  address_summary: string | null;
  zip_code: string | null;
  participant_id: string | null;
  updated_at: string;
};

const safeJsonParse = (
  value: string,
  logger?: Logger,
): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    logger?.error(
      { error: error instanceof Error ? error.message : "unknown" },
      "db.safeJsonParse.failed",
    );
  }
  return {};
};

const mapJoinedCustomer = (
  row: JoinedCustomerRow,
): CustomerCache | undefined => {
  const customerId = row.customer_join_id ?? row.customer_id ?? null;
  if (
    !customerId ||
    !row.customer_phone_e164 ||
    !row.customer_display_name ||
    !row.customer_updated_at
  ) {
    return undefined;
  }
  return {
    id: customerId,
    crmCustomerId: row.customer_crm_id ?? customerId,
    displayName: row.customer_display_name,
    phoneE164: row.customer_phone_e164,
    addressSummary: row.customer_address_summary ?? null,
    zipCode: row.customer_zip_code ?? null,
    participantId: row.customer_participant_id ?? null,
    updatedAt: row.customer_updated_at,
  };
};

const extractCallSummary = (summary: string | null, logger?: Logger) => {
  if (!summary) {
    return null;
  }
  const parsed = safeJsonParse(summary, logger) as { callSummary?: unknown };
  const value = parsed.callSummary;
  return typeof value === "string" ? value : null;
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
    customer: mapJoinedCustomer(row),
  };
};

export const mapTicketEventRow = (
  row: TicketEventRow,
  logger?: Logger,
): TicketEvent => {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    ts: row.ts,
    type: row.type,
    payload: safeJsonParse(row.payload_json, logger),
  };
};

export const mapCallSessionRow = (row: CallSessionRow, logger?: Logger) => {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    phoneE164: row.phone_e164,
    customerCacheId: row.customer_cache_id ?? null,
    status: row.status,
    transport: row.transport,
    summary: row.summary ?? null,
    callSummary: extractCallSummary(row.summary ?? null, logger),
    customer: mapJoinedCustomer(row),
  };
};

export const mapCallTurnRow = (row: CallTurnRow, logger?: Logger) => {
  return {
    id: row.id,
    callSessionId: row.call_session_id,
    ts: row.ts,
    speaker: row.speaker,
    text: row.text,
    meta: safeJsonParse(row.meta_json, logger),
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
    customer: mapJoinedCustomer(row),
  };
};

export const mapCustomerCacheRow = (row: CustomerCacheRow): CustomerCache => {
  return {
    id: row.id,
    crmCustomerId: row.crm_customer_id,
    displayName: row.display_name,
    phoneE164: row.phone_e164,
    addressSummary: row.address_summary ?? null,
    zipCode: row.zip_code ?? null,
    participantId: row.participant_id ?? null,
    updatedAt: row.updated_at,
  };
};

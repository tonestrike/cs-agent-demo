import {
  type TicketCategory,
  TicketEventType,
  type TicketEventTypeValue,
  type TicketPriority,
  TicketSource,
  type TicketStatus,
  applyStatusTransition,
  createTicket,
} from "@pestcall/core";

import type { createTicketRepository } from "../repositories";

type CreateTicketInput = {
  subject: string;
  description: string;
  priority?: TicketPriority;
  category?: TicketCategory;
  customerCacheId?: string;
  phoneE164?: string;
  assignee?: string;
  source?: TicketSource;
  externalRef?: string;
};

export const listTickets = (
  repo: ReturnType<typeof createTicketRepository>,
  params: {
    status?: TicketStatus;
    q?: string;
    customerCacheId?: string;
    phoneE164?: string;
    limit?: number;
    cursor?: string;
  },
) => repo.list(params);

export const getTicket = (
  repo: ReturnType<typeof createTicketRepository>,
  ticketId: string,
) => {
  return repo.get(ticketId);
};

export const createTicketUseCase = async (
  repo: ReturnType<typeof createTicketRepository>,
  input: CreateTicketInput,
  nowIso = new Date().toISOString(),
) => {
  const ticket = createTicket({
    id: crypto.randomUUID(),
    createdAt: nowIso,
    subject: input.subject,
    description: input.description,
    priority: input.priority,
    category: input.category,
    customerCacheId: input.customerCacheId,
    phoneE164: input.phoneE164,
    assignee: input.assignee,
    source: input.source ?? TicketSource.Agent,
    externalRef: input.externalRef,
  });

  await repo.insert(ticket);
  await repo.addEvent({
    ticketId: ticket.id,
    type: TicketEventType.Created,
    payload: {},
    timestamp: nowIso,
  });

  return ticket;
};

export const addTicketEvent = async (
  repo: ReturnType<typeof createTicketRepository>,
  input: {
    ticketId: string;
    type: TicketEventTypeValue;
    payload: Record<string, unknown>;
  },
  nowIso = new Date().toISOString(),
) => {
  return repo.addEvent({
    ticketId: input.ticketId,
    type: input.type,
    payload: input.payload,
    timestamp: nowIso,
  });
};

export const setTicketStatus = async (
  repo: ReturnType<typeof createTicketRepository>,
  input: {
    ticketId: string;
    status: TicketStatus;
  },
  nowIso = new Date().toISOString(),
) => {
  const ticket = await repo.get(input.ticketId);
  if (!ticket) {
    return { ok: false as const, error: "Ticket not found" };
  }

  const transition = applyStatusTransition(ticket, input.status, nowIso);
  if (!transition.ok) {
    return transition;
  }

  await repo.updateStatus({
    ticketId: ticket.id,
    status: transition.ticket.status,
    updatedAt: transition.ticket.updatedAt,
  });
  await repo.addEvent({
    ticketId: ticket.id,
    type: TicketEventType.StatusChanged,
    payload: {
      from: ticket.status,
      to: transition.ticket.status,
    },
    timestamp: nowIso,
  });

  return transition;
};

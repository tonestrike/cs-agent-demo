import { applyStatusTransition, createTicket } from "@pestcall/core";

import type { TicketRepository } from "../repositories";

export type CreateTicketInput = {
  subject: string;
  description: string;
  priority?: "low" | "normal" | "high" | "urgent";
  category?: "appointment" | "billing" | "service" | "general" | "unknown";
  customerCacheId?: string;
  phoneE164?: string;
  assignee?: string;
  source?: "agent" | "phone" | "web" | "internal";
  externalRef?: string;
};

export const listTickets = (
  repo: TicketRepository,
  params: {
    status?: "open" | "in_progress" | "resolved";
    q?: string;
    limit?: number;
    cursor?: string;
  },
) => repo.list(params);

export const getTicket = (repo: TicketRepository, ticketId: string) => {
  return repo.get(ticketId);
};

export const createTicketUseCase = async (
  repo: TicketRepository,
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
    source: input.source ?? "agent",
    externalRef: input.externalRef,
  });

  await repo.insert(ticket);
  await repo.addEvent({
    ticketId: ticket.id,
    type: "created",
    payload: {},
    timestamp: nowIso,
  });

  return ticket;
};

export const addTicketEvent = async (
  repo: TicketRepository,
  input: {
    ticketId: string;
    type: "created" | "status_changed" | "note_added" | "assignment_changed";
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
  repo: TicketRepository,
  input: {
    ticketId: string;
    status: "open" | "in_progress" | "resolved";
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
    type: "status_changed",
    payload: {
      from: ticket.status,
      to: transition.ticket.status,
    },
    timestamp: nowIso,
  });

  return transition;
};

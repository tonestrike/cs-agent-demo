import type { Ticket, TicketStatus } from "./types";

const allowedTransitions: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress", "resolved"],
  in_progress: ["open", "resolved"],
  resolved: ["open"]
};

export type TicketStatusTransitionResult =
  | { ok: true; ticket: Ticket }
  | { ok: false; error: string };

export const isValidStatusTransition = (
  current: TicketStatus,
  next: TicketStatus
): boolean => {
  return allowedTransitions[current].includes(next);
};

export const applyStatusTransition = (
  ticket: Ticket,
  next: TicketStatus,
  nowIso: string
): TicketStatusTransitionResult => {
  if (ticket.status === next) {
    return { ok: true, ticket: { ...ticket, updatedAt: nowIso } };
  }

  if (!isValidStatusTransition(ticket.status, next)) {
    return {
      ok: false,
      error: `Invalid status transition from ${ticket.status} to ${next}`
    };
  }

  return {
    ok: true,
    ticket: {
      ...ticket,
      status: next,
      updatedAt: nowIso
    }
  };
};

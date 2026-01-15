import { ORPCError } from "@orpc/server";
import { TicketEventType } from "@pestcall/core";
import { z } from "zod";

import { authedProcedure } from "../middleware/auth";
import {
  addTicketEvent,
  createTicketUseCase,
  getTicket,
  listTickets,
  setTicketStatus,
} from "../use-cases/tickets";

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
  type: z.nativeEnum(TicketEventType),
  payload: z.record(z.unknown()),
});

const ticketStatusUpdateSchema = z.object({
  ticketId: z.string().min(1),
  status: ticketStatusSchema,
});

export const ticketProcedures = {
  list: authedProcedure
    .input(listTicketsInputSchema)
    .output(listTicketsOutputSchema)
    .handler(async ({ input, context }) => {
      return listTickets(context.deps.tickets, input);
    }),
  get: authedProcedure
    .input(ticketIdInputSchema)
    .output(ticketOutputSchema)
    .handler(async ({ input, context }) => {
      const ticket = await getTicket(context.deps.tickets, input.ticketId);
      if (!ticket) {
        throw new ORPCError("NOT_FOUND", { message: "Ticket not found" });
      }

      return ticket;
    }),
  create: authedProcedure
    .input(createTicketInputSchema)
    .output(ticketOutputSchema)
    .handler(async ({ input, context }) => {
      return createTicketUseCase(context.deps.tickets, input);
    }),
  addEvent: authedProcedure
    .input(ticketEventInputSchema)
    .handler(async ({ input, context }) => {
      return addTicketEvent(context.deps.tickets, input);
    }),
  setStatus: authedProcedure
    .input(ticketStatusUpdateSchema)
    .output(ticketOutputSchema)
    .handler(async ({ input, context }) => {
      const result = await setTicketStatus(context.deps.tickets, input);
      if (!result.ok) {
        const message =
          result.error === "Ticket not found"
            ? "Ticket not found"
            : result.error;
        throw new ORPCError("BAD_REQUEST", { message });
      }

      return result.ticket;
    }),
};

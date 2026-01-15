import { ORPCError } from "@orpc/server";
import {
  ticketCreateInputSchema,
  ticketEventInputSchema,
  ticketIdInputSchema,
  ticketListInputSchema,
  ticketListOutputSchema,
  ticketSchema,
  ticketStatusUpdateSchema,
} from "@pestcall/core";

import { authedProcedure } from "../middleware/auth";
import {
  addTicketEvent,
  createTicketUseCase,
  getTicket,
  listTickets,
  setTicketStatus,
} from "../use-cases/tickets";

export const ticketProcedures = {
  list: authedProcedure
    .input(ticketListInputSchema)
    .output(ticketListOutputSchema)
    .handler(async ({ input, context }) => {
      return listTickets(context.deps.tickets, input);
    }),
  get: authedProcedure
    .input(ticketIdInputSchema)
    .output(ticketSchema)
    .handler(async ({ input, context }) => {
      const ticket = await getTicket(context.deps.tickets, input.ticketId);
      if (!ticket) {
        throw new ORPCError("NOT_FOUND", { message: "Ticket not found" });
      }

      return ticket;
    }),
  create: authedProcedure
    .input(ticketCreateInputSchema)
    .output(ticketSchema)
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
    .output(ticketSchema)
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

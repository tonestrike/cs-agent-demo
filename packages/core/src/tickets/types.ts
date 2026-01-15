import type { z } from "zod";

import {
  TicketEventType,
  type ticketCategorySchema,
  type ticketEventSchema,
  type ticketPrioritySchema,
  type ticketSchema,
  type ticketSourceSchema,
  type ticketStatusSchema,
} from "./schemas";

export { TicketEventType };

export type TicketStatus = z.infer<typeof ticketStatusSchema>;
export type TicketPriority = z.infer<typeof ticketPrioritySchema>;
export type TicketCategory = z.infer<typeof ticketCategorySchema>;
export type TicketSource = z.infer<typeof ticketSourceSchema>;
export type Ticket = z.infer<typeof ticketSchema>;
export type TicketEvent = z.infer<typeof ticketEventSchema>;
export type TicketEventTypeValue = TicketEvent["type"];

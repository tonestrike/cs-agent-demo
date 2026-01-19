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

export const TicketStatus = {
  Open: "open",
  InProgress: "in_progress",
  Resolved: "resolved",
} as const;

export const TicketPriority = {
  Low: "low",
  Normal: "normal",
  High: "high",
  Urgent: "urgent",
} as const;

export const TicketCategory = {
  Appointment: "appointment",
  Billing: "billing",
  Service: "service",
  General: "general",
  Unknown: "unknown",
} as const;

export const TicketSource = {
  Agent: "agent",
  Phone: "phone",
  Web: "web",
  Internal: "internal",
} as const;

export type TicketStatus = z.infer<typeof ticketStatusSchema>;
export type TicketPriority = z.infer<typeof ticketPrioritySchema>;
export type TicketCategory = z.infer<typeof ticketCategorySchema>;
export type TicketSource = z.infer<typeof ticketSourceSchema>;
export type Ticket = z.infer<typeof ticketSchema>;
export type TicketEvent = z.infer<typeof ticketEventSchema>;
export type TicketEventTypeValue = TicketEvent["type"];

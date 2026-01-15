import { z } from "zod";

export const ticketStatusSchema = z.enum(["open", "in_progress", "resolved"]);
export const ticketPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const ticketCategorySchema = z.enum([
  "appointment",
  "billing",
  "service",
  "general",
  "unknown",
]);
export const ticketSourceSchema = z.enum(["agent", "phone", "web", "internal"]);

export enum TicketEventType {
  Created = "created",
  StatusChanged = "status_changed",
  NoteAdded = "note_added",
  AssignmentChanged = "assignment_changed",
  FollowUpRequired = "follow_up_required",
}

export const ticketSchema = z.object({
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

export const ticketEventSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  ts: z.string(),
  type: z.nativeEnum(TicketEventType),
  payload: z.record(z.unknown()),
});

export const ticketListInputSchema = z.object({
  status: ticketStatusSchema.optional(),
  q: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const ticketListOutputSchema = z.object({
  items: z.array(ticketSchema),
  nextCursor: z.string().nullable(),
});

export const ticketCreateInputSchema = z.object({
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

export const ticketIdInputSchema = z.object({
  ticketId: z.string().min(1),
});

export const ticketEventInputSchema = z.object({
  ticketId: z.string().min(1),
  type: z.nativeEnum(TicketEventType),
  payload: z.record(z.unknown()),
});

export const ticketStatusUpdateSchema = z.object({
  ticketId: z.string().min(1),
  status: ticketStatusSchema,
});

export type TicketListInput = z.infer<typeof ticketListInputSchema>;
export type TicketListOutput = z.infer<typeof ticketListOutputSchema>;
export type TicketCreateInput = z.infer<typeof ticketCreateInputSchema>;
export type TicketIdInput = z.infer<typeof ticketIdInputSchema>;
export type TicketEventInput = z.infer<typeof ticketEventInputSchema>;
export type TicketStatusUpdateInput = z.infer<typeof ticketStatusUpdateSchema>;

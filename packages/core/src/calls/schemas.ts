import { z } from "zod";

export const callListInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  phoneE164: z.string().optional(),
  customerCacheId: z.string().optional(),
});

export const callSessionSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  phoneE164: z.string(),
  customerCacheId: z.string().nullable(),
  status: z.string(),
  transport: z.string(),
  summary: z.string().nullable(),
});

export const callTurnSchema = z.object({
  id: z.string(),
  callSessionId: z.string(),
  ts: z.string(),
  speaker: z.string(),
  text: z.string(),
  meta: z.record(z.unknown()),
});

export const callDetailSchema = z.object({
  session: callSessionSchema.nullable(),
  turns: z.array(callTurnSchema),
});

export const callListOutputSchema = z.object({
  items: z.array(callSessionSchema),
  nextCursor: z.string().nullable(),
});

export const callIdInputSchema = z.object({
  callSessionId: z.string().min(1),
});

export const callTicketLookupInputSchema = z.object({
  ticketId: z.string().min(1),
});

export const callTicketLookupOutputSchema = z.object({
  callSessionId: z.string().nullable(),
});

export type CallListInput = z.infer<typeof callListInputSchema>;
export type CallListOutput = z.infer<typeof callListOutputSchema>;
export type CallSession = z.infer<typeof callSessionSchema>;
export type CallTurn = z.infer<typeof callTurnSchema>;
export type CallDetail = z.infer<typeof callDetailSchema>;
export type CallIdInput = z.infer<typeof callIdInputSchema>;
export type CallTicketLookupInput = z.infer<typeof callTicketLookupInputSchema>;
export type CallTicketLookupOutput = z.infer<
  typeof callTicketLookupOutputSchema
>;

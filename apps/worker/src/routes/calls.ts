import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { authedProcedure } from "../middleware/auth";
import { getCallDetail, listCalls } from "../usecases/calls";

const listCallsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional()
});

const callSessionOutputSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  phoneE164: z.string(),
  customerCacheId: z.string().nullable(),
  status: z.string(),
  transport: z.string(),
  summary: z.string().nullable()
});

const callTurnOutputSchema = z.object({
  id: z.string(),
  callSessionId: z.string(),
  ts: z.string(),
  speaker: z.string(),
  text: z.string(),
  meta: z.record(z.unknown())
});

const callDetailOutputSchema = z.object({
  session: callSessionOutputSchema,
  turns: z.array(callTurnOutputSchema)
});

export const callProcedures = {
  list: authedProcedure
    .input(listCallsInputSchema)
    .output(
      z.object({
        items: z.array(callSessionOutputSchema),
        nextCursor: z.string().nullable()
      })
    )
    .handler(async ({ input, context }) => {
      return listCalls(context.deps.calls, input);
    }),
  get: authedProcedure
    .input(z.object({ callSessionId: z.string().min(1) }))
    .output(callDetailOutputSchema)
    .handler(async ({ input, context }) => {
      const detail = await getCallDetail(context.deps.calls, input.callSessionId);
      if (!detail) {
        throw new ORPCError("NOT_FOUND", { message: "Call session not found" });
      }

      return detail;
    })
};

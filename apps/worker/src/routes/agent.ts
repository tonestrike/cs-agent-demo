import { ORPCError } from "@orpc/server";
import { AppError } from "@pestcall/core";
import { z } from "zod";

import { authedProcedure } from "../middleware/auth";
import { handleAgentMessage } from "../use-cases/agent";

const agentMessageInputSchema = z.object({
  callSessionId: z.string().optional(),
  phoneNumber: z.string().min(1),
  text: z.string().min(1),
});

const agentMessageOutputSchema = z.object({
  callSessionId: z.string(),
  replyText: z.string(),
  actions: z.array(z.string()),
  ticketId: z.string().optional(),
});

export const agentProcedures = {
  message: authedProcedure
    .input(agentMessageInputSchema)
    .output(agentMessageOutputSchema)
    .handler(async ({ input, context }) => {
      try {
        return await handleAgentMessage(context.deps, input);
      } catch (error) {
        if (error instanceof AppError) {
          throw new ORPCError("BAD_REQUEST", {
            message: error.message,
            data: error.meta,
          });
        }
        throw error;
      }
    }),
};

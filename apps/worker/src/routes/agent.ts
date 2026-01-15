import { ORPCError } from "@orpc/server";
import { AppError } from "@pestcall/core";

import { authedProcedure } from "../middleware/auth";
import {
  agentMessageInputSchema,
  agentMessageOutputSchema,
} from "../schemas/agent";
import { handleAgentMessage } from "../use-cases/agent";

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

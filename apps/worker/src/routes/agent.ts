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
      const sessionId = input.callSessionId ?? crypto.randomUUID();
      const normalizedInput = { ...input, callSessionId: sessionId };
      const publish = (event: {
        type: string;
        text?: string;
        data?: unknown;
      }) => {
        if (!context.env.CONVERSATION_HUB) {
          return;
        }
        const id = context.env.CONVERSATION_HUB.idFromName(sessionId);
        const stub = context.env.CONVERSATION_HUB.get(id);
        void stub.fetch("https://conversation-hub/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(event),
        });
      };
      try {
        const response = await handleAgentMessage(
          context.deps,
          normalizedInput,
          undefined,
          {
            onStatus: (status) => {
              publish({ type: "status", text: status.text });
            },
            onToken: (token) => {
              publish({ type: "delta", text: token });
            },
          },
        );
        publish({ type: "final", data: response });
        return response;
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

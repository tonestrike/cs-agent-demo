import { ORPCError } from "@orpc/server";
import {
  callDetailSchema,
  callIdInputSchema,
  callListInputSchema,
  callListOutputSchema,
} from "@pestcall/core";

import { authedProcedure } from "../middleware/auth";
import { getCallDetail, listCalls } from "../use-cases/calls";

export const callProcedures = {
  list: authedProcedure
    .input(callListInputSchema)
    .output(callListOutputSchema)
    .handler(async ({ input, context }) => {
      return listCalls(context.deps.calls, input);
    }),
  get: authedProcedure
    .input(callIdInputSchema)
    .output(callDetailSchema)
    .handler(async ({ input, context }) => {
      const detail = await getCallDetail(
        context.deps.calls,
        input.callSessionId,
      );
      if (!detail) {
        throw new ORPCError("NOT_FOUND", { message: "Call session not found" });
      }

      return detail;
    }),
};

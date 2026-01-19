import {
  callContextOutputSchema,
  callDetailSchema,
  callIdInputSchema,
  callListInputSchema,
  callListOutputSchema,
  callTicketLookupInputSchema,
  callTicketLookupOutputSchema,
} from "@pestcall/core";

import { authedProcedure } from "../middleware/auth";
import { getCallContext, getCallDetail, listCalls } from "../use-cases/calls";

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
      return detail ?? { session: null, turns: [] };
    }),
  context: authedProcedure
    .input(callIdInputSchema)
    .output(callContextOutputSchema)
    .handler(async ({ input, context }) => {
      return getCallContext(
        context.deps.calls,
        context.deps.logger,
        input.callSessionId,
      );
    }),
  findByTicketId: authedProcedure
    .input(callTicketLookupInputSchema)
    .output(callTicketLookupOutputSchema)
    .handler(async ({ input, context }) => {
      const callSessionId = await context.deps.calls.findSessionByTicketId(
        input.ticketId,
      );
      return { callSessionId };
    }),
};

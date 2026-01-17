/**
 * Handler for crm.getAvailableSlots tool
 */

import { getAvailableSlots } from "../../../../use-cases/crm";
import { formatAvailableSlotsResponse } from "../../formatters";
import type {
  ToolExecutionInput,
  ToolFlowContext,
  ToolRawResult,
} from "../types";

export async function handleGetAvailableSlots(
  ctx: ToolFlowContext,
  { args }: ToolExecutionInput<"crm.getAvailableSlots">,
): Promise<ToolRawResult> {
  const customerId =
    args.customerId ??
    ctx.sessionState.conversation?.verification.customerId ??
    "";

  const slots = await getAvailableSlots(ctx.deps.crm, customerId, args);

  if (slots.length === 0) {
    return {
      toolName: "crm.getAvailableSlots",
      result: [],
      fallback:
        "I couldn't find any available times right now. Would you like me to check again later?",
      contextHint: "No slots available. Offer to check again.",
    };
  }

  return {
    toolName: "crm.getAvailableSlots",
    result: slots.map((slot) => ({
      id: slot.id,
      date: slot.date,
      timeWindow: slot.timeWindow,
    })),
    stateUpdates: {
      availableSlots: slots.map((slot) => ({
        id: slot.id,
        date: slot.date,
        timeWindow: slot.timeWindow,
      })),
    },
    fallback: formatAvailableSlotsResponse(slots, "Which one works best?"),
    contextHint:
      "Offer available times and confirm whether the on-file address is correct.",
  };
}

/**
 * Handler for crm.listUpcomingAppointments tool
 */

import {
  applyIntent,
  initialConversationState,
} from "../../../../conversation/state-machine";
import { listUpcomingAppointments } from "../../../../use-cases/crm";
import { formatAppointmentsResponse } from "../../formatters";
import type {
  ToolExecutionInput,
  ToolFlowContext,
  ToolRawResult,
} from "../types";

export async function handleListAppointments(
  ctx: ToolFlowContext,
  { args, input }: ToolExecutionInput<"crm.listUpcomingAppointments">,
): Promise<ToolRawResult> {
  const customerId =
    args.customerId ??
    ctx.sessionState.conversation?.verification.customerId ??
    "";
  const limit = args.limit ?? 3;

  const appointments = await listUpcomingAppointments(
    ctx.deps.crm,
    customerId,
    limit,
  );

  // Side effect: update appointment summary in DB
  const callSessionId = input.callSessionId ?? crypto.randomUUID();
  await ctx.updateAppointmentSummary(
    callSessionId,
    input.phoneNumber,
    appointments,
  );

  if (appointments.length === 0) {
    return {
      toolName: "crm.listUpcomingAppointments",
      result: [],
      fallback:
        "I couldn't find any upcoming appointments. Would you like to schedule one?",
      contextHint: "No appointments found. Offer to schedule.",
    };
  }

  // Build state updates with conversation state machine
  const state = ctx.sessionState.conversation ?? initialConversationState();
  const updatedConversation = applyIntent(state, {
    type: "appointments_loaded",
    appointments: appointments.map((appointment) => ({
      id: appointment.id,
      date: appointment.date,
      timeWindow: appointment.timeWindow,
      addressSummary: appointment.addressSummary,
    })),
  });

  return {
    toolName: "crm.listUpcomingAppointments",
    result: appointments.map((appointment) => ({
      id: appointment.id,
      customerId,
      date: appointment.date,
      timeWindow: appointment.timeWindow,
      addressSummary: appointment.addressSummary,
    })),
    stateUpdates: {
      conversation: updatedConversation,
    },
    fallback: formatAppointmentsResponse(appointments),
    contextHint: "Share upcoming appointments and ask what they'd like to do.",
  };
}

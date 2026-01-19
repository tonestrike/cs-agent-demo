/**
 * Handler for crm.cancelAppointment tool
 */

import {
  applyIntent,
  initialConversationState,
} from "../../../../conversation/state-machine";
import { cancelAppointment } from "../../../../use-cases/crm";
import type {
  ToolExecutionInput,
  ToolFlowContext,
  ToolRawResult,
} from "../types";

export async function handleCancelAppointment(
  ctx: ToolFlowContext,
  { args }: ToolExecutionInput<"crm.cancelAppointment">,
): Promise<ToolRawResult> {
  // Get appointment ID from args or from pending cancellation
  const appointmentId =
    args.appointmentId ??
    ctx.sessionState.conversation?.pendingCancellationId ??
    "";

  if (!appointmentId) {
    return {
      toolName: "crm.cancelAppointment",
      result: { ok: false, error: "no_appointment_id" },
      fallback:
        "I need to know which appointment to cancel. Would you like me to list your upcoming appointments?",
      contextHint: "No appointment ID provided. Ask customer to specify.",
    };
  }

  ctx.logger.info(
    { appointmentId },
    "tool_handler.cancel_appointment.executing",
  );

  const cancelResult = await cancelAppointment(ctx.deps.crm, appointmentId);

  if (!cancelResult.ok) {
    ctx.logger.warn(
      { appointmentId },
      "tool_handler.cancel_appointment.failed",
    );
    return {
      toolName: "crm.cancelAppointment",
      result: { ok: false, error: "cancellation_failed" },
      fallback:
        "I wasn't able to cancel that appointment. Let me connect you with a specialist who can help.",
      contextHint: "Cancellation failed. Offer to escalate.",
    };
  }

  ctx.logger.info({ appointmentId }, "tool_handler.cancel_appointment.success");

  // Update conversation state to mark cancellation complete
  const state = ctx.sessionState.conversation ?? initialConversationState();
  const updatedConversation = applyIntent(state, {
    type: "cancel_confirmed",
  });

  return {
    toolName: "crm.cancelAppointment",
    result: { ok: true, appointmentId },
    stateUpdates: {
      conversation: updatedConversation,
    },
    fallback:
      "Your appointment has been cancelled. Is there anything else I can help you with?",
    contextHint:
      "Appointment cancelled successfully. Confirm to customer and ask if they need anything else.",
  };
}

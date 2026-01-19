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
  // Log the raw args to see what the model is passing
  ctx.logger.info(
    { argsRaw: JSON.stringify(args) },
    "tool_handler.cancel_appointment.start",
  );

  // Check activeSelection for appointments in a cancel workflow
  const activeSelection = ctx.sessionState.activeSelection as
    | {
        kind: string;
        options: Array<{ id: string; label: string }>;
        workflowType: string;
      }
    | undefined;

  // Get appointment ID from args, pending cancellation, or fall back to activeSelection
  // This handles the case where the model doesn't pass the ID explicitly but
  // the user has confirmed they want to cancel an appointment from the presented list
  let appointmentId =
    args.appointmentId ??
    ctx.sessionState.conversation?.pendingCancellationId ??
    "";

  // If no ID from args but we have a single appointment in activeSelection for cancel,
  // assume the user wants to cancel that one
  if (
    !appointmentId &&
    activeSelection?.workflowType === "cancel" &&
    activeSelection?.kind === "appointment" &&
    activeSelection?.options?.length === 1
  ) {
    appointmentId = activeSelection.options[0].id;
    ctx.logger.info(
      { appointmentId, source: "activeSelection_single" },
      "tool_handler.cancel_appointment.using_active_selection",
    );
  }

  ctx.logger.info(
    {
      appointmentId,
      argsAppointmentId: args.appointmentId,
      pendingCancellationId:
        ctx.sessionState.conversation?.pendingCancellationId,
      activeSelectionOptions: activeSelection?.options?.map((o) => o.id),
    },
    "tool_handler.cancel_appointment.resolved_id",
  );

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

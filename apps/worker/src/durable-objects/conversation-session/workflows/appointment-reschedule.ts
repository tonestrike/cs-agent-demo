/**
 * Reschedule workflow handler
 *
 * Handles the reschedule appointment workflow orchestration.
 */

import { listUpcomingAppointments } from "../../../use-cases/crm";
import type { StartWorkflowResult, WorkflowContext } from "./types";

/**
 * Start a reschedule workflow for the customer.
 * Creates workflow instance, fetches appointments, and updates state.
 */
export async function startRescheduleWorkflow(
  ctx: WorkflowContext,
  input: {
    customerId?: string;
    phoneNumber?: string;
    message?: string;
  },
): Promise<StartWorkflowResult> {
  const callSessionId = ctx.callSessionId;
  if (!callSessionId) {
    return { ok: false, message: "No active session found." };
  }

  const phoneNumber =
    input.phoneNumber ?? ctx.sessionState.lastPhoneNumber ?? null;
  if (!phoneNumber) {
    return { ok: false, message: "Phone number is required to reschedule." };
  }

  await ctx.ensureCallSession(callSessionId, phoneNumber);

  const workflowBinding = ctx.deps.workflows.reschedule;
  if (!workflowBinding) {
    return { ok: false, message: "Rescheduling is temporarily unavailable." };
  }

  const customerId =
    input.customerId ??
    ctx.sessionState.conversation?.verification.customerId ??
    null;
  if (!customerId) {
    return {
      ok: false,
      message: "Customer verification is required before rescheduling.",
    };
  }

  // Emit status immediately to give user feedback while we fetch data
  ctx.emitEvent({
    type: "status",
    text: "Sure - I'm pulling your upcoming appointments now so we can pick the right one to reschedule.",
  });

  const instance = await workflowBinding.create({
    params: {
      callSessionId,
      customerId,
      intent: "reschedule" as const,
      message: input.message ?? "Reschedule my appointment.",
    },
  });

  const appointments = await listUpcomingAppointments(
    ctx.deps.crm,
    customerId,
    3,
  );

  await ctx.updateAppointmentSummary(callSessionId, phoneNumber, appointments);

  await ctx.updateState({
    rescheduleWorkflowId: instance.id,
    availableSlots: undefined,
  });

  await ctx.syncConversationState(callSessionId);

  return {
    ok: true,
    message: instance.id,
    data: { instanceId: instance.id, appointments },
  };
}

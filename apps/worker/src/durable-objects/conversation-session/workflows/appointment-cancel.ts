/**
 * Cancel workflow handler
 *
 * Handles the cancel appointment workflow orchestration.
 */

import {
  applyIntent,
  initialConversationState,
} from "../../../conversation/state-machine";
import { listUpcomingAppointments } from "../../../use-cases/crm";
import { CANCEL_WORKFLOW_EVENT_CONFIRM } from "../../../workflows/constants";
import type {
  StartWorkflowResult,
  WorkflowContext,
  WorkflowResult,
} from "./types";

/**
 * Start a cancel workflow for the customer.
 * Creates workflow instance, fetches appointments, and updates state.
 */
export async function startCancelWorkflow(
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
    return { ok: false, message: "Phone number is required to cancel." };
  }

  await ctx.ensureCallSession(callSessionId, phoneNumber);

  const workflowBinding = ctx.deps.workflows.cancel;
  if (!workflowBinding) {
    return { ok: false, message: "Cancellation is temporarily unavailable." };
  }

  const customerId =
    input.customerId ??
    ctx.sessionState.conversation?.verification.customerId ??
    null;
  if (!customerId) {
    return {
      ok: false,
      message: "Customer verification is required before cancelling.",
    };
  }

  // Emit status immediately to give user feedback while we fetch data
  ctx.emitEvent({
    type: "status",
    text: "Sure - I'm pulling your upcoming appointments now so we can pick the right one to cancel.",
  });

  const instance = await workflowBinding.create({
    params: {
      callSessionId,
      customerId,
      intent: "cancel" as const,
      message: input.message ?? "Cancel my appointment.",
    },
  });

  const appointments = await listUpcomingAppointments(
    ctx.deps.crm,
    customerId,
    3,
  );

  await ctx.updateAppointmentSummary(callSessionId, phoneNumber, appointments);

  await ctx.updateState({
    cancelWorkflowId: instance.id,
    availableSlots: undefined,
  });

  await ctx.syncConversationState(callSessionId);

  return {
    ok: true,
    message: instance.id,
    data: { instanceId: instance.id, appointments },
  };
}

/**
 * Handle cancel confirmation (yes/no from user).
 */
export async function handleCancelConfirmation(
  ctx: WorkflowContext,
  confirmed: boolean,
): Promise<WorkflowResult<{ statusText: string }>> {
  const sessionId = ctx.callSessionId;
  if (!sessionId) {
    return { ok: false, message: "No active session found." };
  }

  const workflowBinding = ctx.deps.workflows.cancel;
  if (!workflowBinding) {
    return { ok: false, message: "Cancellation is temporarily unavailable." };
  }

  // Load session summary to get workflow state
  const session = await ctx.deps.calls.getSession(sessionId);
  if (!session?.summary) {
    return { ok: false, message: "Unable to load cancellation state." };
  }

  let summary: {
    workflowState?: { kind: string; instanceId?: string };
  } | null = null;
  try {
    summary = JSON.parse(session.summary);
  } catch (error) {
    ctx.logger.error(
      { error: error instanceof Error ? error.message : "unknown" },
      "conversation.session.summary.parse_failed",
    );
    return { ok: false, message: "Unable to load cancellation state." };
  }

  const workflow = summary?.workflowState;
  const instanceId =
    workflow?.kind === "cancel"
      ? (workflow.instanceId ?? ctx.sessionState.cancelWorkflowId)
      : ctx.sessionState.cancelWorkflowId;

  if (!instanceId) {
    return { ok: false, message: "Cancellation workflow not found." };
  }

  const instance = await workflowBinding.get(instanceId);
  await instance.sendEvent({
    type: CANCEL_WORKFLOW_EVENT_CONFIRM,
    payload: { confirmed },
  });

  // All customer-facing text must be model-generated
  const contextHint = confirmed
    ? "Confirm you're canceling the appointment in a warm, helpful tone."
    : "Acknowledge that you won't cancel the appointment in a friendly tone.";

  const statusText = await ctx.emitNarratorStatus(
    {
      callSessionId: sessionId,
      phoneNumber: ctx.sessionState.lastPhoneNumber ?? "unknown",
      text: confirmed ? "cancel confirmed" : "cancel declined",
    },
    "",
    contextHint,
  );

  const current = ctx.sessionState.conversation ?? initialConversationState();
  await ctx.updateState({
    conversation: applyIntent(current, {
      type: confirmed ? "cancel_confirmed" : "cancel_declined",
    }),
    cancelWorkflowId: instanceId,
  });

  return { ok: true, data: { statusText: statusText ?? "" } };
}

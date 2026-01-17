/**
 * Tool argument normalization and action plan evaluation
 */

import type { ActionPlan, ActionPrecondition } from "../../../models/types";
import type { ConversationState } from "../../../conversation/state-machine";
import { initialConversationState } from "../../../conversation/state-machine";
import type { SessionState } from "../types";

/**
 * Normalize tool arguments by injecting verified customer ID where needed
 */
export function normalizeToolArgs(
  toolName: string,
  args: Record<string, unknown>,
  conversationState: ConversationState | undefined,
): Record<string, unknown> {
  const state = conversationState ?? initialConversationState();
  const next: Record<string, unknown> & { customerId?: string } = {
    ...args,
  };
  if (!state.verification.verified || !state.verification.customerId) {
    return next;
  }
  switch (toolName) {
    case "crm.listUpcomingAppointments":
    case "crm.getNextAppointment":
    case "crm.getOpenInvoices":
    case "crm.getAvailableSlots":
    case "crm.createAppointment":
      if (!("customerId" in next)) {
        next.customerId = state.verification.customerId;
      }
      break;
    case "crm.verifyAccount":
      if (!("customerId" in next)) {
        next.customerId = state.verification.customerId;
      }
      break;
    default:
      break;
  }
  return next;
}

/**
 * Get the preconditions required for a tool
 */
export function getActionPreconditions(
  toolName: ActionPlan["toolName"],
): ActionPrecondition[] {
  switch (toolName) {
    case "crm.verifyAccount":
    case "crm.lookupCustomerByPhone":
    case "crm.lookupCustomerByNameAndZip":
    case "crm.lookupCustomerByEmail":
    case "agent.escalate":
    case "agent.fallback":
      return [];
    default:
      return ["verified"];
  }
}

export type ActionPlanEvalResult = {
  ok: boolean;
  message?: string;
  contextHint?: string;
};

/**
 * Evaluate whether an action plan's preconditions are met
 */
export function evaluateActionPlan(
  plan: ActionPlan,
  sessionState: SessionState,
): ActionPlanEvalResult {
  const state = sessionState.conversation ?? initialConversationState();
  const required = plan.required ?? [];

  if (required.includes("verified") && !state.verification.verified) {
    return {
      ok: false,
      message: "Please share the 5-digit ZIP code on your account first.",
      contextHint: "Ask for the 5-digit ZIP code to verify the account.",
    };
  }

  if (required.includes("has_appointments") && !state.appointments.length) {
    return {
      ok: false,
      message: "Let me pull up your upcoming appointments first.",
      contextHint: "Acknowledge and say you're fetching appointments.",
    };
  }

  if (
    required.includes("has_available_slots") &&
    !(sessionState.availableSlots?.length ?? 0)
  ) {
    return {
      ok: false,
      message: "Let me check the available times first.",
      contextHint: "Acknowledge and say you're checking availability.",
    };
  }

  if (
    required.includes("pending_cancellation") &&
    !state.pendingCancellationId
  ) {
    return {
      ok: false,
      message: "Which appointment would you like to cancel?",
      contextHint: "Ask which appointment should be canceled.",
    };
  }

  return { ok: true };
}

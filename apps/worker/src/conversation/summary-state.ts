import {
  type ConversationState,
  applyIntent,
  initialConversationState,
} from "./state-machine";

export type SummarySnapshot = {
  identityStatus?: string;
  verifiedCustomerId?: string | null;
  lastAppointmentOptions?: Array<{
    id: string;
    date: string;
    timeWindow: string;
    addressSummary: string;
  }>;
  lastAppointmentId?: string | null;
  workflowState?: {
    kind?: string;
    step?: string;
    appointmentId?: string | null;
    instanceId?: string | null;
  };
};

export const deriveConversationStateFromSummary = (
  current: ConversationState | undefined,
  summary: SummarySnapshot,
): ConversationState => {
  let next = current ?? initialConversationState();
  if (summary.identityStatus === "verified" && summary.verifiedCustomerId) {
    next = applyIntent(next, {
      type: "verified",
      customerId: summary.verifiedCustomerId,
    });
  }

  const appointments = Array.isArray(summary.lastAppointmentOptions)
    ? summary.lastAppointmentOptions
    : [];
  if (appointments.length) {
    next = applyIntent(next, {
      type: "appointments_loaded",
      appointments,
    });
  }

  const workflow = summary.workflowState;
  const cancelId = workflow?.appointmentId ?? summary.lastAppointmentId ?? null;
  if (workflow?.kind === "cancel" && workflow.step === "confirm" && cancelId) {
    next = applyIntent(next, {
      type: "cancel_requested",
      appointmentId: cancelId,
    });
  }
  if (workflow?.kind === "cancel" && workflow.step === "declined") {
    next = applyIntent(next, { type: "cancel_declined" });
  }
  if (workflow?.kind === "cancel" && workflow.step === "complete") {
    next = applyIntent(next, { type: "cancel_confirmed" });
  }

  return next;
};

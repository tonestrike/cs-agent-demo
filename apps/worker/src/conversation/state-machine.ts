import { z } from "zod";

export const conversationStateSchema = z.object({
  status: z.enum([
    "CollectingVerification",
    "VerifiedIdle",
    "DisambiguatingIntent",
    "PresentingAppointments",
    "PresentingSlots",
    "PendingCancellationConfirmation",
    "PendingRescheduleConfirmation",
    "PendingScheduleDetails",
    "PendingScheduleConfirmation",
    "Completed",
  ]),
  verification: z.object({
    verified: z.boolean(),
    customerId: z.string().nullable(),
    zipAttempts: z.number().int().nonnegative(),
  }),
  appointments: z
    .array(
      z.object({
        id: z.string(),
        date: z.string(),
        timeWindow: z.string(),
        addressSummary: z.string(),
      }),
    )
    .default([]),
  pendingCancellationId: z.string().nullable(),
  pendingRescheduleId: z.string().nullable(),
  pendingRescheduleSlotId: z.string().nullable(),
  pendingScheduleSlotId: z.string().nullable(),
  pendingScheduleAddressConfirmed: z.boolean().default(false),
});

export type ConversationState = z.infer<typeof conversationStateSchema>;

export const initialConversationState = (): ConversationState => ({
  status: "CollectingVerification",
  verification: {
    verified: false,
    customerId: null,
    zipAttempts: 0,
  },
  appointments: [],
  pendingCancellationId: null,
  pendingRescheduleId: null,
  pendingRescheduleSlotId: null,
  pendingScheduleSlotId: null,
  pendingScheduleAddressConfirmed: false,
});

export type ConversationIntent =
  | { type: "request_verification"; reason: "missing" | "invalid_zip" }
  | { type: "verified"; customerId: string }
  | { type: "intent_ambiguous" }
  | {
      type: "appointments_loaded";
      appointments: ConversationState["appointments"];
    }
  | { type: "appointments_listed" }
  | { type: "cancel_requested"; appointmentId: string }
  | { type: "cancel_confirmed" }
  | { type: "cancel_declined" }
  | { type: "reschedule_requested"; appointmentId: string }
  | { type: "reschedule_slot_selected"; slotId: string }
  | { type: "reschedule_confirmed" }
  | { type: "reschedule_declined" }
  | { type: "schedule_requested" }
  | { type: "schedule_address_confirmed" }
  | { type: "schedule_slot_selected"; slotId: string }
  | { type: "schedule_confirmed" }
  | { type: "schedule_declined" };

export const applyIntent = (
  state: ConversationState,
  intent: ConversationIntent,
): ConversationState => {
  switch (intent.type) {
    case "request_verification":
      return {
        ...state,
        status: "CollectingVerification",
        verification: {
          ...state.verification,
          verified: false,
          customerId: null,
          zipAttempts:
            intent.reason === "invalid_zip"
              ? state.verification.zipAttempts + 1
              : state.verification.zipAttempts,
        },
      };
    case "verified":
      return {
        ...state,
        status: "VerifiedIdle",
        verification: {
          verified: true,
          customerId: intent.customerId,
          zipAttempts: 0,
        },
      };
    case "intent_ambiguous":
      return {
        ...state,
        status: "DisambiguatingIntent",
      };
    case "appointments_listed":
      return {
        ...state,
        status: "PresentingAppointments",
      };
    case "appointments_loaded":
      return {
        ...state,
        status: "PresentingAppointments",
        appointments: intent.appointments,
      };
    case "cancel_requested":
      return {
        ...state,
        status: "PendingCancellationConfirmation",
        pendingCancellationId: intent.appointmentId,
      };
    case "cancel_confirmed":
      return {
        ...state,
        status: "Completed",
        pendingCancellationId: null,
      };
    case "cancel_declined":
      return {
        ...state,
        status: "VerifiedIdle",
        pendingCancellationId: null,
      };
    case "reschedule_requested":
      return {
        ...state,
        status: "PresentingSlots",
        pendingRescheduleId: intent.appointmentId,
        pendingRescheduleSlotId: null,
      };
    case "reschedule_slot_selected":
      return {
        ...state,
        status: "PendingRescheduleConfirmation",
        pendingRescheduleSlotId: intent.slotId,
      };
    case "reschedule_confirmed":
      return {
        ...state,
        status: "Completed",
        pendingRescheduleId: null,
        pendingRescheduleSlotId: null,
      };
    case "reschedule_declined":
      return {
        ...state,
        status: "VerifiedIdle",
        pendingRescheduleId: null,
        pendingRescheduleSlotId: null,
      };
    case "schedule_requested":
      return {
        ...state,
        status: "PendingScheduleDetails",
        pendingScheduleSlotId: null,
        pendingScheduleAddressConfirmed: false,
      };
    case "schedule_address_confirmed":
      return {
        ...state,
        status: "PresentingSlots",
        pendingScheduleAddressConfirmed: true,
      };
    case "schedule_slot_selected":
      return {
        ...state,
        status: "PendingScheduleConfirmation",
        pendingScheduleSlotId: intent.slotId,
      };
    case "schedule_confirmed":
      return {
        ...state,
        status: "Completed",
        pendingScheduleSlotId: null,
        pendingScheduleAddressConfirmed: false,
      };
    case "schedule_declined":
      return {
        ...state,
        status: "VerifiedIdle",
        pendingScheduleSlotId: null,
        pendingScheduleAddressConfirmed: false,
      };
    default:
      return state;
  }
};

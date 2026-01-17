import { z } from "zod";

export const conversationStateSchema = z.object({
  status: z.enum([
    "CollectingVerification",
    "VerifiedIdle",
    "PresentingAppointments",
    "PendingCancellationConfirmation",
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
});

export type ConversationIntent =
  | { type: "request_verification"; reason: "missing" | "invalid_zip" }
  | { type: "verified"; customerId: string }
  | {
      type: "appointments_loaded";
      appointments: ConversationState["appointments"];
    }
  | { type: "appointments_listed" }
  | { type: "cancel_requested"; appointmentId: string }
  | { type: "cancel_confirmed" }
  | { type: "cancel_declined" };

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
    default:
      return state;
  }
};

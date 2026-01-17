/**
 * Helper functions for appointment workflows
 *
 * These are model-friendly utilities that support conversational flows.
 * All interpretation of user input is delegated to the model for flexibility.
 */

import type { ConversationState } from "../../../conversation/state-machine";
import type { SelectionKind } from "./types";

/**
 * Maps conversation status to the expected selection kind.
 * Returns null if no selection is expected in the current state.
 *
 * The model can use this hint to understand what type of selection
 * it should be looking for in user input.
 */
export function getExpectedSelectionKind(
  conversationState: ConversationState | undefined,
): SelectionKind | null {
  const status = conversationState?.status;
  switch (status) {
    case "PresentingAppointments":
      return "appointment";
    case "PresentingSlots":
      return "slot";
    case "PendingCancellationConfirmation":
    case "PendingRescheduleConfirmation":
      return "confirmation";
    default:
      return null;
  }
}

/** Build appointment options for model selection */
export function buildAppointmentOptions(
  appointments: Array<{
    id: string;
    date: string;
    timeWindow: string;
    addressSummary: string;
  }>,
): Array<{ id: string; label: string }> {
  return appointments.map((appointment) => ({
    id: appointment.id,
    label: appointment.addressSummary
      ? `${appointment.date} ${appointment.timeWindow} @ ${appointment.addressSummary}`
      : `${appointment.date} ${appointment.timeWindow}`,
  }));
}

/** Build slot options for model selection */
export function buildSlotOptions(
  slots: Array<{ id: string; date: string; timeWindow: string }>,
): Array<{ id: string; label: string }> {
  return slots.map((slot) => ({
    id: slot.id,
    label: `${slot.date} ${slot.timeWindow}`,
  }));
}

/** Standard confirmation options for the model */
export const CONFIRMATION_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "confirm", label: "Yes, confirm" },
  { id: "decline", label: "No, do not change it" },
];

/**
 * Checks if the selection state is stale.
 * Used to clear old selections and avoid confusion.
 */
export function isSelectionStale(
  presentedAt: number | undefined,
  timeoutMs = 5 * 60 * 1000, // 5 minutes default
): boolean {
  if (!presentedAt) {
    return false;
  }
  return Date.now() - presentedAt > timeoutMs;
}

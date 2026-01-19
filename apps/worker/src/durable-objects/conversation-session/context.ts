import { initialConversationState } from "../../conversation/state-machine";
import { formatAppointmentLabel, formatSlotLabel } from "./formatters";
import type { SessionState } from "./types";

export const buildModelContext = (sessionState: SessionState): string => {
  const state = sessionState.conversation ?? initialConversationState();
  const lines = [
    `Identity status: ${state.verification.verified ? "verified" : "unknown"}`,
  ];
  if (state.appointments.length) {
    const summary = state.appointments
      .map(
        (appointment, index) =>
          `${index + 1}) ${formatAppointmentLabel(appointment)}`,
      )
      .join(" ");
    lines.push(`Cached appointments: ${summary}`);
  }
  if (sessionState.availableSlots?.length) {
    const summary = sessionState.availableSlots
      .map((slot, index) => `${index + 1}) ${formatSlotLabel(slot)}`)
      .join(" ");
    lines.push(`Cached available slots: ${summary}`);
  }
  return lines.join("\n");
};

/**
 * Pure functions for formatting appointment data
 */

import type { AppointmentData } from "../types";

/**
 * Format a single appointment label
 */
export function formatAppointmentLabel(appointment: {
  date: string;
  timeWindow: string;
  addressSummary: string;
}): string {
  return `${appointment.date} ${appointment.timeWindow} at ${appointment.addressSummary}`;
}

/**
 * Format a list of appointments for display
 */
export function formatAppointmentsResponse(
  appointments: AppointmentData[],
): string {
  const intro =
    appointments.length === 1
      ? "Here is your upcoming appointment:"
      : "Here are your upcoming appointments:";
  const lines = appointments.map((appointment, index) => {
    const dateLabel = appointment.date;
    const timeLabel = appointment.timeWindow;
    return `${index + 1}) ${dateLabel} ${timeLabel} at ${appointment.addressSummary}`;
  });
  return [intro, ...lines].join(" ");
}

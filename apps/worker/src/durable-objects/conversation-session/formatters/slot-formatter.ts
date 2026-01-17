/**
 * Pure functions for formatting slot data
 */

import type { SlotData } from "../types";

/**
 * Format a single slot label
 */
export function formatSlotLabel(slot: {
  date: string;
  timeWindow: string;
}): string {
  return `${slot.date} ${slot.timeWindow}`;
}

/**
 * Format a list of available slots for display
 */
export function formatAvailableSlotsResponse(
  slots: SlotData[],
  prompt?: string,
): string {
  const intro =
    slots.length === 1
      ? "Here is the next available time:"
      : "Here are the next available times:";
  const lines = slots.map((slot, index) => {
    return `${index + 1}) ${formatSlotLabel(slot)}`;
  });
  const base = [intro, ...lines].join(" ");
  return prompt ? `${base} ${prompt}` : base;
}

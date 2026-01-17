/**
 * Zod validation schemas and constants for conversation session
 */

import { z } from "zod";

/** Maximum number of events to keep in the buffer */
export const MAX_EVENT_BUFFER = 200;

/** Timeout in ms before emitting a filler message */
export const FILLER_TIMEOUT_MS = 400;

/** Tool names that support acknowledgement status messages */
export const toolAcknowledgementSchema = z.enum([
  "crm.listUpcomingAppointments",
  "crm.getNextAppointment",
  "crm.cancelAppointment",
  "crm.rescheduleAppointment",
  "crm.getAvailableSlots",
  "crm.createAppointment",
  "crm.getOpenInvoices",
  "crm.getServicePolicy",
]);

export type ToolAcknowledgementName = z.infer<typeof toolAcknowledgementSchema>;

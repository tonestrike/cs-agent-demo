/**
 * Appointment workflow handlers for conversation session
 *
 * This module exports handlers for appointment cancel/reschedule flows.
 * These handlers are designed to be highly conversational and model-driven,
 * supporting multiple concurrent flows and intents.
 */

export type {
  WorkflowContext,
  WorkflowResult,
  StartWorkflowResult,
  SelectionKind,
  SelectionOptions,
} from "./types";

export {
  startCancelWorkflow,
  handleCancelConfirmation,
} from "./appointment-cancel";
export { startRescheduleWorkflow } from "./appointment-reschedule";
export {
  handleWorkflowSelection,
  type SelectionResult,
} from "./appointment-selection";

export {
  getExpectedSelectionKind,
  buildAppointmentOptions,
  buildSlotOptions,
  CONFIRMATION_OPTIONS,
  isSelectionStale,
} from "./appointment-helpers";

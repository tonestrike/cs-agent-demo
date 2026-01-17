/**
 * Conversation Session Module
 *
 * This module contains the refactored conversation session durable object
 * and its supporting modules.
 */

// Types
export type {
  ConversationEvent,
  ConversationEventType,
  SessionState,
  ClientMessage,
  AppointmentData,
  SlotData,
  InvoiceData,
  SessionData,
  TurnData,
} from "./types";

// Schemas and constants
export {
  MAX_EVENT_BUFFER,
  FILLER_TIMEOUT_MS,
  toolAcknowledgementSchema,
  type ToolAcknowledgementName,
} from "./schemas";

// Formatters
export {
  formatAppointmentLabel,
  formatAppointmentsResponse,
  formatSlotLabel,
  formatAvailableSlotsResponse,
  formatInvoicesResponse,
  formatConversationSummary,
} from "./formatters";

// Narration
export {
  sanitizeNarratorOutput,
  createNarrator,
  type Narrator,
  type NarratorDeps,
  type NarratorInput,
  type NarratorCustomerContext,
  type NarratorModelAdapter,
} from "./narration";

// Events
export {
  createEventEmitter,
  createBargeInHandler,
  type EventEmitter,
  type EventEmitterDeps,
  type EventEmitterState,
  type BargeInHandler,
  type BargeInHandlerDeps,
} from "./events";

// Telemetry
export {
  createTurnMetricsTracker,
  type TurnMetricsTracker,
  type TurnMetrics,
  type TurnTimings,
  type TurnDecision,
  type ModelCall,
  type ToolCall,
  type TurnMetricsState,
} from "./telemetry";

// Tools
export {
  normalizeToolArgs,
  getActionPreconditions,
  evaluateActionPlan,
  type ActionPlanEvalResult,
} from "./tools";

/**
 * Conversation Session Module
 *
 * This module contains the refactored conversation session durable object
 * and its supporting modules.
 */

export type {
  ConversationEvent,
  ClientMessage,
  SessionState,
} from "./types";

export {
  MAX_EVENT_BUFFER,
  FILLER_TIMEOUT_MS,
  toolAcknowledgementSchema,
} from "./schemas";

export {
  formatAppointmentLabel,
  formatAppointmentsResponse,
  formatSlotLabel,
  formatAvailableSlotsResponse,
  formatInvoicesResponse,
  formatConversationSummary,
} from "./formatters";

export { sanitizeNarratorOutput } from "./narration";

export {
  normalizeToolArgs,
  getActionPreconditions,
  evaluateActionPlan,
} from "./tools";

export {
  type FallbackDiagnostics,
  type DebugFacts,
  type DebugAnalysis,
  type AIDebugResult,
  buildFallbackWithDiagnostics,
  extractDiagnosticsFromFallback,
  isInterpretFallback,
  analyzeDebugDiagnostics,
  formatDebugAnalysis,
  generateDebugSummary,
  buildAIDebugPrompt,
  parseAIDebugResponse,
  formatAIDebugResult,
} from "./fallback";

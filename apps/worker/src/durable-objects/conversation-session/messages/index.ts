/**
 * Messaging module
 *
 * Handles turn recording, message retrieval, and session summary updates.
 *
 * All functions are pure and take their dependencies as parameters,
 * avoiding `this` binding issues.
 *
 * Usage:
 * ```ts
 * const ctx = { logger, calls: deps.calls };
 * await recordTurns(ctx, { callSessionId, phoneNumber, userText, agentText });
 * const messages = await getRecentMessages(ctx, callSessionId);
 * ```
 */

export { updateAppointmentSummary, updateIdentitySummary } from "./summary";
export {
  ensureCallSession,
  getRecentMessages,
  recordStatusTurn,
  recordTurns,
} from "./turns";
export type {
  CallsRepository,
  MessagesContext,
  ModelMessage,
  SummarySnapshot,
  TurnInput,
} from "./types";

/**
 * Types for messaging module
 */

import type { createDependencies } from "../../../context";
import type { Logger } from "../../../logger";

/** Call repository interface (subset of deps.calls) */
export type CallsRepository = ReturnType<typeof createDependencies>["calls"];

/** Summary snapshot stored in session */
export type SummarySnapshot = {
  identityStatus?: string;
  verifiedCustomerId?: string;
  lastAppointmentOptions?: Array<{
    id: string;
    date: string;
    timeWindow: string;
    addressSummary: string;
  }>;
};

/** Message in model format */
export type ModelMessage = {
  role: "user" | "assistant";
  content: string;
};

/** Context for messaging operations */
export type MessagesContext = {
  logger: Logger;
  calls: CallsRepository;
};

/** Turn input for recording */
export type TurnInput = {
  callSessionId: string;
  phoneNumber: string;
  userText: string;
  agentText: string;
  turnId?: number;
  meta?: Record<string, unknown>;
};

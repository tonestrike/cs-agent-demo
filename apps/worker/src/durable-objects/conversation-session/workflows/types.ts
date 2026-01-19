/**
 * Types for workflow handlers
 *
 * This module defines the context interface and types used by workflow handlers.
 * The context pattern avoids `this` binding issues when extracting methods.
 */

import type { createDependencies } from "../../../context";
import type { ConversationState } from "../../../conversation/state-machine";
import type { Logger } from "../../../logger";
import type { ToolResult } from "../../../models/types";
import type { AgentMessageInput } from "../../../schemas/agent";
import type { SessionState } from "../types";

/** Workflow operation result */
export type WorkflowResult<T = void> = {
  ok: boolean;
  message?: string;
  data?: T;
};

/** Start workflow result with appointments */
export type StartWorkflowResult = WorkflowResult<{
  instanceId: string;
  appointments: Array<{
    id: string;
    date: string;
    timeWindow: string;
    addressSummary: string;
  }>;
}>;

/** Workflow context interface - provides dependencies and state operations */
export type WorkflowContext = {
  /** Logger instance */
  logger: Logger;

  /** Current session state (read-only snapshot) */
  readonly sessionState: SessionState;

  /** Active call session ID */
  readonly callSessionId: string | null;

  /** Dependencies */
  deps: ReturnType<typeof createDependencies>;

  /** Current stream ID for cancellation checks */
  streamId: number;

  /** Get current conversation state */
  getConversationState(): ConversationState;

  /** Update session state and persist to storage */
  updateState(updates: Partial<SessionState>): Promise<void>;

  /** Emit an event to connected clients */
  emitEvent(event: { type: string; text?: string; data?: unknown }): void;

  /** Ensure call session exists in DB */
  ensureCallSession(callSessionId: string, phoneNumber: string): Promise<void>;

  /** Sync conversation state to summary */
  syncConversationState(callSessionId: string): Promise<void>;

  /** Update appointment summary in DB */
  updateAppointmentSummary(
    callSessionId: string,
    phoneNumber: string,
    appointments: Array<{
      id: string;
      date: string;
      timeWindow: string;
      addressSummary: string;
    }>,
  ): Promise<void>;

  /** Narrate text using the model */
  narrateText(
    input: AgentMessageInput,
    fallback: string,
    contextHint?: string,
  ): Promise<string>;

  /** Narrate tool result using the model */
  narrateToolResult(
    toolResult: ToolResult,
    options: {
      input: AgentMessageInput;
      fallback: string;
      contextHint?: string;
    },
  ): Promise<string>;

  /** Emit narrator status message */
  emitNarratorStatus(
    input: { callSessionId: string; phoneNumber: string; text: string },
    fallback: string,
    contextHint?: string,
  ): Promise<string | null>;

  /** Select an option using the model */
  selectOption(
    input: AgentMessageInput,
    kind: "appointment" | "slot" | "confirmation",
    options: Array<{ id: string; label: string }>,
  ): Promise<string | null>;
};

/** Selection kind for workflow flows */
export type SelectionKind = "appointment" | "slot" | "confirmation";

/** Options for workflow selection handling */
export type SelectionOptions = {
  appointments: Array<{
    id: string;
    date: string;
    timeWindow: string;
    addressSummary: string;
  }>;
  slots: Array<{ id: string; date: string; timeWindow: string }>;
};

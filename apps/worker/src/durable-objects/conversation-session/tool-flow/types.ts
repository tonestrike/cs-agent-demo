/**
 * Types for tool flow handling
 *
 * Tool execution follows this pattern:
 * 1. Multiple tools may be called in a single turn
 * 2. Each tool handler returns its raw result
 * 3. Results are aggregated
 * 4. A single narration step produces the final response
 *
 * This allows the model to understand and narrate the combined
 * outcome of all tool calls, not just individual results.
 */

import type { z } from "zod";
import type { createDependencies } from "../../../context";
import type { ConversationState } from "../../../conversation/state-machine";
import type { Logger } from "../../../logger";
import type {
  AgentToolName,
  toolDefinitions,
} from "../../../models/tool-definitions";
import type { ToolResult } from "../../../models/types";
import type { AgentMessageInput } from "../../../schemas/agent";
import type { SessionState } from "../types";

/** Infer the args type for a tool from its input schema */
export type ToolArgs<T extends AgentToolName> = z.infer<
  (typeof toolDefinitions)[T]["inputSchema"]
>;

/** Raw result from a tool execution (before narration) */
export type ToolRawResult = {
  toolName: string;
  result: unknown;
  /** State updates to apply after this tool completes */
  stateUpdates?: Partial<SessionState>;
  /** Fallback text if narration fails */
  fallback: string;
  /** Hint for the narrator about how to present this result */
  contextHint: string;
};

/** Result of executing one or more tools (before narration) */
export type ToolExecutionResult = {
  callSessionId: string;
  results: ToolRawResult[];
  /** Combined acknowledgement from all tool calls */
  acknowledgementText?: string;
  /** Debug info */
  debug?: Record<string, unknown>;
};

/** Final output after narration */
export type ToolFlowOutput = {
  callSessionId: string;
  replyText: string;
  actions: unknown[];
  debug?: Record<string, unknown>;
};

/** Context interface for tool handlers */
export type ToolFlowContext = {
  /** Logger instance */
  logger: Logger;

  /** Current session state (read-only snapshot) */
  readonly sessionState: SessionState;

  /** Dependencies */
  deps: ReturnType<typeof createDependencies>;

  /** Current stream ID for cancellation checks */
  streamId: number;

  /** Get current conversation state */
  getConversationState(): ConversationState;

  /** Update session state and persist to storage */
  updateState(updates: Partial<SessionState>): Promise<void>;

  /** Narrate aggregated tool results */
  narrateToolResults(
    results: ToolRawResult[],
    input: AgentMessageInput,
    priorAcknowledgement?: string,
  ): Promise<string>;

  /** Narrate single tool result (for backwards compatibility) */
  narrateToolResult(
    toolResult: ToolResult,
    options: {
      input: AgentMessageInput;
      fallback: string;
      contextHint?: string;
      priorAcknowledgement?: string;
    },
  ): Promise<string>;

  /** Narrate text (for error/fallback cases) */
  narrateText(
    input: AgentMessageInput,
    fallback: string,
    contextHint?: string,
  ): Promise<string>;

  /** Join acknowledgement with narration */
  joinNarration(first: string, second: string): string;

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
};

/** Input for tool execution with typed args */
export type ToolExecutionInput<T extends AgentToolName = AgentToolName> = {
  toolName: T;
  args: ToolArgs<T>;
  input: AgentMessageInput;
};

/** Single tool handler - returns raw result, not narrated text */
export type ToolHandler<T extends AgentToolName = AgentToolName> = (
  ctx: ToolFlowContext,
  input: ToolExecutionInput<T>,
) => Promise<ToolRawResult>;

/** Registry of tool handlers */
export type ToolHandlerRegistry = {
  [K in AgentToolName]?: ToolHandler<K>;
};

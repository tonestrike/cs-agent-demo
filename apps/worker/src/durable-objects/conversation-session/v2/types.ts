/**
 * Type definitions for ConversationSession v2
 *
 * This is a completely generic conversation session system.
 * No domain knowledge lives here - not even "customer service" assumptions.
 *
 * The architecture:
 * - Session: WebSocket + state coordination (this module)
 * - Agent Loop: Model orchestration (../agent-loop)
 * - Tools: All business logic and domain knowledge
 *
 * Everything is injected via builders and function parameters.
 */

import type { Ai, DurableObjectState } from "@cloudflare/workers-types";

/**
 * Generic session state stored in durable object storage.
 *
 * The session tracks minimal metadata. Domain-specific state
 * (verification, workflows, etc.) is stored in `domainState`
 * as an opaque record that the agent-loop manages.
 */
export type SessionState = {
  /** Last phone number associated with this session */
  phoneNumber?: string;
  /** Last call session ID */
  callSessionId?: string;
  /** Domain-specific state managed by agent-loop/tools */
  domainState: Record<string, unknown>;
  /** Last activity timestamp */
  lastActivityAt?: number;
};

/** Initial empty session state */
export const initialSessionState = (): SessionState => ({
  domainState: {},
  lastActivityAt: Date.now(),
});

/**
 * Event types emitted to connected clients.
 */
export type EventType =
  | "token" // Streaming token from model
  | "status" // Status update (e.g., "thinking...")
  | "final" // Final response complete
  | "error" // Error occurred
  | "resync" // Full state resync requested
  | "speaking" // Speaking state change
  | "tool_call"; // Tool was invoked

/**
 * Event emitted to connected WebSocket clients.
 */
export type SessionEvent = {
  /** Unique event ID for ordering */
  id: number;
  /** Sequence number for this connection */
  seq: number;
  /** Event type */
  type: EventType;
  /** Text content (for token, final, status) */
  text?: string;
  /** Additional data payload */
  data?: unknown;
  /** Turn ID this event belongs to */
  turnId?: number | null;
  /** Message ID for deduplication */
  messageId?: string | null;
  /** Role (assistant or system) */
  role?: "assistant" | "system";
  /** Correlation ID for tracing */
  correlationId?: string;
  /** ISO timestamp */
  at: string;
};

/**
 * Messages received from connected clients.
 */
export type ClientMessage =
  | { type: "barge_in" }
  | { type: "resync"; lastEventId?: number }
  | {
      type: "message";
      text: string;
      phoneNumber?: string;
      callSessionId?: string;
    }
  | {
      type: "final_transcript";
      text: string;
      phoneNumber?: string;
      callSessionId?: string;
    };

/**
 * Configuration for the session.
 */
export type SessionConfig = {
  /** Maximum events to buffer for resync */
  maxEventBuffer: number;
  /** Model to use for agent loop */
  model: string;
  /** Maximum tool runs per turn */
  maxToolRuns: number;
  /** Enable verbose logging */
  verbose: boolean;
};

/** Default session configuration */
export const defaultSessionConfig: SessionConfig = {
  maxEventBuffer: 100,
  model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  maxToolRuns: 5,
  verbose: false,
};

/**
 * Logger interface - generic logging abstraction.
 * Implementations can use any logging library.
 */
export type Logger = {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
  debug(data: Record<string, unknown>, message: string): void;
};

/**
 * Tool definition for the agent loop.
 * Tools contain all domain/business logic.
 */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
  /**
   * Optional acknowledgement to stream while the tool runs.
   * Can be a string (always show) or a function that returns string | null
   * based on current state (return null to skip acknowledgement if data is cached).
   */
  acknowledgement?: string | ((state: SessionState) => string | null);
};

/**
 * Tool execution function.
 * Returns a result that the model can interpret.
 */
export type ToolExecutor = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Promise<unknown>;

/**
 * Context provided to tool executors.
 */
export type ToolContext = {
  /** Current session state */
  sessionState: SessionState;
  /** Update session state */
  updateState: (updates: Partial<SessionState["domainState"]>) => Promise<void>;
  /** Logger */
  logger: Logger;
  /** Current message input */
  input: MessageInput;
};

/**
 * Tool provider - factory for building tools.
 * This is how domain logic is injected into the session.
 */
export type ToolProvider = {
  /** Get all available tools */
  getTools: (state: SessionState) => Array<{
    definition: ToolDefinition;
    execute: ToolExecutor;
  }>;
};

/**
 * Prompt provider - factory for building system prompts.
 * This is how agent personality/behavior is injected.
 */
export type PromptProvider = {
  /** Build system instructions based on current state (async for RAG retrieval) */
  buildSystemPrompt: (
    state: SessionState,
    userMessage?: string,
  ) => Promise<string>;
  /** Get the initial greeting message */
  getGreeting: () => string;
};

/**
 * Dependencies injected into the session via builder pattern.
 */
export type SessionDeps = {
  /** Durable object state */
  durableState: DurableObjectState;
  /** Workers AI binding (optional - enables agent loop) */
  ai?: Ai;
  /** Logger instance */
  logger: Logger;
  /** Tool provider - injects domain logic */
  toolProvider: ToolProvider;
  /** Prompt provider - injects agent behavior */
  promptProvider: PromptProvider;
  /** Environment bindings */
  env: Record<string, unknown>;
};

/**
 * Input for processing a user message.
 */
export type MessageInput = {
  /** User's message text */
  text: string;
  /** Phone number (for voice calls) */
  phoneNumber?: string;
  /** Call session ID (for voice calls) */
  callSessionId?: string;
  /** Correlation ID for tracing */
  correlationId?: string;
};

/**
 * Result from processing a message.
 */
export type MessageResult = {
  /** Response text */
  response: string;
  /** Whether this was streamed */
  streamed: boolean;
  /** Number of tool calls made */
  toolCallCount: number;
  /** Turn ID */
  turnId: number;
  /** Message ID */
  messageId: string;
};

/**
 * Conversation Session v2
 *
 * A clean, modular, generic implementation of the conversation durable object.
 * No domain knowledge lives here - all business logic is injected via providers.
 *
 * Architecture:
 * - types.ts      - Type definitions and interfaces
 * - state.ts      - Session state persistence
 * - events.ts     - Event emission to clients
 * - connection.ts - WebSocket management
 * - session.ts    - Main session class
 * - factory.ts    - Factory functions for easy setup
 * - providers/    - Domain-specific providers
 *
 * Quick Start:
 * ```ts
 * import { createSession } from "./v2";
 *
 * const session = createSession({
 *   durableState: this.state,
 *   ai: env.AI,
 *   logger: this.logger,
 *   deps: createDependencies(env, ctx),
 *   agentConfig: await deps.agentConfig.get(defaults),
 * });
 *
 * return session.fetch(request);
 * ```
 *
 * Custom Providers:
 * ```ts
 * const session = SessionBuilder.create(durableState)
 *   .withLogger(logger)
 *   .withAI(env.AI)
 *   .withToolProvider(myToolProvider)
 *   .withPromptProvider(myPromptProvider)
 *   .build();
 * ```
 *
 * @module conversation-session/v2
 */

// Main exports
export { ConversationSessionV2, SessionBuilder } from "./session";
export { ConversationSessionV2DO } from "./durable-object";
export { createStateManager, StateManager } from "./state";
export { createEventEmitter, EventEmitter } from "./events";
export { createConnectionManager, ConnectionManager } from "./connection";

// Factory exports
export {
  createSession,
  createTestSession,
  type SessionFactoryConfig,
} from "./factory";

// Provider exports
export {
  createToolProvider,
  createEmptyToolProvider,
  createPromptProvider,
  createMinimalPromptProvider,
  createCustomPromptProvider,
  type ToolProviderConfig,
  type PromptProviderConfig,
} from "./providers";

// Type exports
export {
  defaultSessionConfig,
  initialSessionState,
  type ClientMessage,
  type EventType,
  type Logger,
  type MessageInput,
  type MessageResult,
  type PromptProvider,
  type SessionConfig,
  type SessionDeps,
  type SessionEvent,
  type SessionState,
  type ToolContext,
  type ToolDefinition,
  type ToolExecutor,
  type ToolProvider,
} from "./types";

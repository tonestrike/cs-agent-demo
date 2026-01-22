/**
 * Factory functions for ConversationSession v2
 *
 * Provides convenient factory functions to create fully-wired
 * session instances with all dependencies configured.
 */

import type { Ai, DurableObjectState } from "@cloudflare/workers-types";
import type { AgentPromptConfig } from "@pestcall/core";
import type { createDependencies } from "../../../context";
import type { Env } from "../../../env";
import type { Logger } from "../../../logger";
import { createAnthropicAdapter } from "../../../models/anthropic";
import type { KnowledgeRetriever } from "../../../rag";
import { createPromptProvider } from "./providers/prompt-provider";
import { createToolProvider } from "./providers/tool-provider";
import { type ConversationSessionV2, SessionBuilder } from "./session";

/**
 * Configuration for creating a v2 session.
 */
export type SessionFactoryConfig = {
  /** Durable object state */
  durableState: DurableObjectState;
  /** Workers AI binding */
  ai?: Ai;
  /** Logger instance */
  logger: Logger;
  /** Dependencies from createDependencies() */
  deps: ReturnType<typeof createDependencies>;
  /** Agent configuration */
  agentConfig: AgentPromptConfig;
  /** Stream ID for cancellation */
  streamId?: number;
  /** Environment bindings (typed as Env for model adapter creation) */
  env?: Env;
  /** Knowledge retriever for RAG (optional) */
  knowledgeRetriever?: KnowledgeRetriever;
};

/**
 * Create a fully-configured ConversationSession v2.
 *
 * This is the main factory function that wires up:
 * - Tool provider with existing tool handlers
 * - Prompt provider with agent configuration
 * - Session with all dependencies
 *
 * Usage:
 * ```ts
 * const session = createSession({
 *   durableState: this.state,
 *   ai: env.AI,
 *   logger: this.logger,
 *   deps: createDependencies(env, ctx),
 *   agentConfig: await deps.agentConfig.get(defaults),
 * });
 *
 * const response = await session.fetch(request);
 * ```
 */
export function createSession(
  config: SessionFactoryConfig,
): ConversationSessionV2 {
  const {
    durableState,
    ai,
    logger,
    deps,
    agentConfig,
    streamId = 1,
    env,
    knowledgeRetriever,
  } = config;

  // Create providers
  const toolProvider = createToolProvider({
    deps,
    streamId,
  });

  const promptProvider = createPromptProvider({
    agentConfig,
    knowledgeRetriever,
  });

  // Create model adapter if Anthropic is configured
  const modelAdapter =
    env?.ANTHROPIC_API_KEY && env.AGENT_MODEL === "anthropic"
      ? createAnthropicAdapter(
          env,
          env.ANTHROPIC_MODEL_ID ?? "",
          agentConfig,
          logger,
        )
      : undefined;

  // Build session
  const builder = SessionBuilder.create(durableState)
    .withLogger(logger)
    .withAI(ai)
    .withToolProvider(toolProvider)
    .withPromptProvider(promptProvider)
    .withEnv(env ?? {});

  if (modelAdapter) {
    builder.withModelAdapter(modelAdapter);
  }

  return builder.build();
}

/**
 * Create a minimal session for testing.
 *
 * This creates a session with empty providers - useful for
 * testing the session mechanics without domain logic.
 */
export function createTestSession(
  durableState: DurableObjectState,
  logger: Logger,
): ConversationSessionV2 {
  const { createEmptyToolProvider } = require("./providers/tool-provider");
  const {
    createMinimalPromptProvider,
  } = require("./providers/prompt-provider");

  return SessionBuilder.create(durableState)
    .withLogger(logger)
    .withToolProvider(createEmptyToolProvider())
    .withPromptProvider(createMinimalPromptProvider())
    .build();
}

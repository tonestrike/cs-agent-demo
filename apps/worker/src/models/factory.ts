import type { AgentPromptConfig } from "@pestcall/core";
import type { Env } from "../env";
import type { Logger } from "../logger";
import { createAnthropicAdapter } from "./anthropic";
import { createOpenRouterAdapter } from "./openrouter";
import type { ModelAdapter } from "./types";

export type AdapterType = "anthropic" | "openrouter" | "workers-ai" | "auto";

/**
 * Create a model adapter based on the specified type.
 *
 * The `"auto"` type will prioritize adapters based on available API keys:
 * 1. Anthropic (if ANTHROPIC_API_KEY is set)
 * 2. OpenRouter (if OPENROUTER_TOKEN is set)
 * 3. Workers AI (fallback, uses Cloudflare AI binding)
 *
 * @param type - The adapter type to create
 * @param env - Environment bindings
 * @param config - Agent prompt configuration
 * @param logger - Logger instance
 * @param modelId - Optional model ID override
 * @returns ModelAdapter instance
 */
export const createModelAdapter = (
  type: AdapterType,
  env: Env,
  config: AgentPromptConfig,
  logger: Logger,
  modelId?: string,
): ModelAdapter | null => {
  const resolvedType = resolveAdapterType(type, env);

  logger.info(
    {
      requestedType: type,
      resolvedType,
      modelId,
      hasAnthropicKey: Boolean(env.ANTHROPIC_API_KEY),
      hasOpenRouterToken: Boolean(env.OPENROUTER_TOKEN),
      hasAiBinding: Boolean(env.AI),
    },
    "model.factory.create",
  );

  switch (resolvedType) {
    case "anthropic": {
      const model =
        modelId ?? env.ANTHROPIC_MODEL_ID ?? "claude-sonnet-4-20250514";
      return createAnthropicAdapter(env, model, config, logger);
    }

    case "openrouter": {
      const model =
        modelId ?? env.AGENT_MODEL_ID ?? "nousresearch/hermes-2-pro-mistral-7b";
      return createOpenRouterAdapter(env, model, config, logger);
    }

    case "workers-ai":
      // Workers AI adapter is handled directly in session.ts via ai.run()
      // Return null to indicate session should use direct AI binding
      return null;

    default:
      logger.warn({ type: resolvedType }, "model.factory.unknown_type");
      return null;
  }
};

/**
 * Resolve the adapter type based on available configuration.
 * When type is "auto", selects the best available adapter.
 */
const resolveAdapterType = (type: AdapterType, env: Env): AdapterType => {
  if (type !== "auto") {
    return type;
  }

  // Priority: Anthropic > OpenRouter > Workers AI
  if (env.ANTHROPIC_API_KEY) {
    return "anthropic";
  }

  if (env.OPENROUTER_TOKEN) {
    return "openrouter";
  }

  // Fallback to Workers AI (always available via AI binding)
  return "workers-ai";
};

/**
 * Check if an adapter type is available (has required configuration).
 */
export const isAdapterAvailable = (type: AdapterType, env: Env): boolean => {
  switch (type) {
    case "anthropic":
      return Boolean(env.ANTHROPIC_API_KEY);

    case "openrouter":
      return Boolean(env.OPENROUTER_TOKEN);

    case "workers-ai":
      return Boolean(env.AI);

    case "auto":
      return (
        isAdapterAvailable("anthropic", env) ||
        isAdapterAvailable("openrouter", env) ||
        isAdapterAvailable("workers-ai", env)
      );

    default:
      return false;
  }
};

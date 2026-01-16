import type { AgentPromptConfig } from "@pestcall/core";
import type { Env } from "../env";
import type { Logger } from "../logger";
import { createHybridModelAdapter } from "./hybrid";
import { createMockModelAdapter } from "./mock";
import { createOpenRouterAdapter } from "./openrouter";
import { createWorkersAiAdapter } from "./workers-ai";

const isWorkersAiModelId = (modelId: string) =>
  modelId.startsWith("@cf/") || modelId.startsWith("@hf/");

const isOpenRouterModelId = (modelId: string) =>
  modelId.includes("/") && !isWorkersAiModelId(modelId);

export const getModelAdapter = (
  env: Env,
  config: AgentPromptConfig,
  logger: Logger,
) => {
  const openRouterModelId = config.modelId ?? "openai/gpt-4o-mini";
  const workersAiModelId =
    env.AGENT_MODEL_ID ?? "@cf/meta/llama-3.1-8b-instruct";
  if (env.AGENT_MODEL === "mock") {
    logger.info(
      {
        provider: "mock",
        envAgentModel: env.AGENT_MODEL ?? null,
        configModelId: config.modelId ?? null,
      },
      "agent.model.selected",
    );
    return createMockModelAdapter(config);
  }
  if (
    env.AGENT_MODEL === "workers-ai" &&
    config.modelId &&
    isOpenRouterModelId(config.modelId)
  ) {
    logger.info(
      {
        provider: "hybrid",
        envAgentModel: env.AGENT_MODEL ?? null,
        configModelId: config.modelId ?? null,
        workersModelId: workersAiModelId,
        openRouterModelId,
      },
      "agent.model.selected",
    );
    const workersAdapter = createWorkersAiAdapter(
      env.AI,
      workersAiModelId,
      config,
      logger,
    );
    const openRouterAdapter = createOpenRouterAdapter(
      env,
      openRouterModelId,
      config,
      logger,
    );
    return createHybridModelAdapter(workersAdapter, openRouterAdapter, logger);
  }
  if (
    env.AGENT_MODEL === "openrouter" ||
    (config.modelId && isOpenRouterModelId(config.modelId))
  ) {
    logger.info(
      {
        provider: "openrouter",
        envAgentModel: env.AGENT_MODEL ?? null,
        configModelId: config.modelId ?? null,
        resolvedModelId: openRouterModelId,
      },
      "agent.model.selected",
    );
    return createOpenRouterAdapter(env, openRouterModelId, config, logger);
  }
  logger.info(
    {
      provider: "workers-ai",
      envAgentModel: env.AGENT_MODEL ?? null,
      configModelId: config.modelId ?? null,
      resolvedModelId: workersAiModelId,
    },
    "agent.model.selected",
  );
  return createWorkersAiAdapter(env.AI, workersAiModelId, config, logger);
};

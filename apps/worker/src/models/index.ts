import type { AgentPromptConfig } from "@pestcall/core";
import type { Env } from "../env";
import type { Logger } from "../logger";
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
  if (env.AGENT_MODEL === "mock") {
    return createMockModelAdapter(config);
  }
  if (
    env.AGENT_MODEL === "openrouter" ||
    (config.modelId && isOpenRouterModelId(config.modelId))
  ) {
    return createOpenRouterAdapter(
      env,
      config.modelId ?? "openai/gpt-4o-mini",
      config,
      logger,
    );
  }
  return createWorkersAiAdapter(
    env.AI,
    config.modelId ?? "@cf/meta/llama-3.1-8b-instruct",
    config,
    logger,
  );
};

import type { AgentPromptConfig } from "@pestcall/core";
import type { Env } from "../env";
import type { Logger } from "../logger";
import { createHybridModelAdapter } from "./hybrid";
import { createMockModelAdapter } from "./mock";
import { createOpenRouterAdapter } from "./openrouter";
import { createSplitModelAdapter } from "./split";
import { createWorkersAiAdapter } from "./workers-ai";

const isWorkersAiModelId = (modelId: string) =>
  modelId.startsWith("@cf/") || modelId.startsWith("@hf/");

const isOpenRouterModelId = (modelId: string) =>
  modelId.includes("/") && !isWorkersAiModelId(modelId);

const resolveOpenRouterModelId = (
  _env: Env,
  config: AgentPromptConfig,
  override?: string,
) => override ?? config.modelId ?? "openai/gpt-4o-mini";

const resolveWorkersModelId = (env: Env, override?: string) =>
  override ?? env.AGENT_MODEL_ID ?? "@cf/meta/llama-3.1-8b-instruct";

const createAdapterFor = (
  env: Env,
  config: AgentPromptConfig,
  logger: Logger,
  provider: "mock" | "workers-ai" | "openrouter",
  modelIdOverride?: string,
) => {
  if (provider === "mock") {
    return createMockModelAdapter(config);
  }
  if (provider === "openrouter") {
    return createOpenRouterAdapter(
      env,
      resolveOpenRouterModelId(env, config, modelIdOverride),
      config,
      logger,
    );
  }
  return createWorkersAiAdapter(
    env.AI,
    resolveWorkersModelId(env, modelIdOverride),
    config,
    logger,
  );
};

export const getModelAdapter = (
  env: Env,
  config: AgentPromptConfig,
  logger: Logger,
) => {
  const openRouterModelId = config.modelId ?? "openai/gpt-4o-mini";
  const workersAiModelId = resolveWorkersModelId(env);
  const interpreterProvider = env.AGENT_INTERPRETER_MODEL ?? null;
  const narratorProvider = env.AGENT_NARRATOR_MODEL ?? null;
  const interpreterModelOverride = env.AGENT_INTERPRETER_MODEL_ID ?? null;
  const narratorModelOverride = env.AGENT_NARRATOR_MODEL_ID ?? null;
  if (
    interpreterProvider ||
    narratorProvider ||
    interpreterModelOverride ||
    narratorModelOverride
  ) {
    const interpreterModelId = env.AGENT_INTERPRETER_MODEL_ID ?? config.modelId;
    const narratorModelId = env.AGENT_NARRATOR_MODEL_ID ?? config.modelId;
    const interpreterConfig = { ...config, modelId: interpreterModelId };
    const narratorConfig = { ...config, modelId: narratorModelId };
    const interpreter = createAdapterFor(
      env,
      interpreterConfig,
      logger,
      interpreterProvider ?? env.AGENT_MODEL ?? "workers-ai",
      interpreterModelId,
    );
    const narrator = createAdapterFor(
      env,
      narratorConfig,
      logger,
      narratorProvider ?? env.AGENT_MODEL ?? "openrouter",
      narratorModelId,
    );
    logger.info(
      {
        provider: "split",
        interpreterProvider: interpreterProvider ?? env.AGENT_MODEL ?? null,
        narratorProvider: narratorProvider ?? env.AGENT_MODEL ?? null,
        interpreterModelId: interpreter.modelId ?? null,
        narratorModelId: narrator.modelId ?? null,
      },
      "agent.model.selected",
    );
    return createSplitModelAdapter(interpreter, narrator, logger);
  }
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

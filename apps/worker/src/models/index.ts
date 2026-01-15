import type { AgentPromptConfig } from "@pestcall/core";
import type { Env } from "../env";
import { createMockModelAdapter } from "./mock";
import { createWorkersAiAdapter } from "./workers-ai";

export const getModelAdapter = (env: Env, config: AgentPromptConfig) => {
  if (env.AGENT_MODEL === "mock") {
    return createMockModelAdapter(config);
  }
  return createWorkersAiAdapter(
    env.AI,
    config.modelId ?? "@cf/meta/llama-3.1-8b-instruct",
    config,
  );
};

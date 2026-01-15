import { getAgentConfig } from "../agents/config";
import type { Env } from "../env";
import { createMockModelAdapter } from "./mock";
import { createWorkersAiAdapter } from "./workers-ai";

export const getModelAdapter = (env: Env) => {
  const config = getAgentConfig(env);
  if (env.AGENT_MODEL === "mock") {
    return createMockModelAdapter(config);
  }
  return createWorkersAiAdapter(
    env.AI,
    "@cf/meta/llama-3.1-8b-instruct",
    config,
  );
};

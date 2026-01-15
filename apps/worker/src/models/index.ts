import type { Env } from "../env";
import { createMockModelAdapter } from "./mock";
import { createWorkersAiAdapter } from "./workers-ai";

export const getModelAdapter = (env: Env) => {
  if (env.AGENT_MODEL === "mock") {
    return createMockModelAdapter();
  }
  return createWorkersAiAdapter(env.AI);
};

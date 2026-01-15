import type {
  AgentPromptConfig,
  AgentPromptConfigRecord,
  AgentPromptConfigUpdate,
} from "@pestcall/core";

import type { createAgentConfigRepository } from "../repositories/agent-config";

export const getAgentPromptConfig = async (
  repo: ReturnType<typeof createAgentConfigRepository>,
  defaults: AgentPromptConfig,
): Promise<AgentPromptConfigRecord> => {
  return repo.get(defaults);
};

export const updateAgentPromptConfig = async (
  repo: ReturnType<typeof createAgentConfigRepository>,
  defaults: AgentPromptConfig,
  input: AgentPromptConfigUpdate,
): Promise<AgentPromptConfigRecord> => {
  return repo.update(defaults, input);
};

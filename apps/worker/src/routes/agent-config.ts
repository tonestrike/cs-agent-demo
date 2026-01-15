import {
  agentPromptConfigRecordSchema,
  agentPromptConfigUpdateSchema,
} from "@pestcall/core";

import { authedProcedure } from "../middleware/auth";
import {
  getAgentPromptConfig,
  updateAgentPromptConfig,
} from "../use-cases/agent-config";

export const agentConfigProcedures = {
  get: authedProcedure
    .output(agentPromptConfigRecordSchema)
    .handler(async ({ context }) => {
      return getAgentPromptConfig(
        context.deps.agentConfig,
        context.deps.agentConfigDefaults,
      );
    }),
  update: authedProcedure
    .input(agentPromptConfigUpdateSchema)
    .output(agentPromptConfigRecordSchema)
    .handler(async ({ input, context }) => {
      return updateAgentPromptConfig(
        context.deps.agentConfig,
        context.deps.agentConfigDefaults,
        input,
      );
    }),
};

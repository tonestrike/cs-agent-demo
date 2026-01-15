import type { AgentPromptConfig } from "@pestcall/core";
import { agentPromptConfigSchema } from "@pestcall/core";

import type { Env } from "../env";

export const getAgentConfig = (env: Env): AgentPromptConfig => {
  return agentPromptConfigSchema.parse({
    tone: env.AGENT_TONE,
    greeting: env.AGENT_GREETING,
    scopeMessage: env.AGENT_SCOPE_MESSAGE ?? env.AGENT_OFFTOPIC_MESSAGE,
    companyName: env.AGENT_COMPANY_NAME,
    personaSummary: env.AGENT_PERSONA_SUMMARY,
    toolGuidance: env.AGENT_TOOL_GUIDANCE
      ? {
          getNextAppointment: env.AGENT_TOOL_GUIDANCE,
          getOpenInvoices: env.AGENT_TOOL_GUIDANCE,
          rescheduleAppointment: env.AGENT_TOOL_GUIDANCE,
          escalate: env.AGENT_TOOL_GUIDANCE,
        }
      : undefined,
    modelId: env.AGENT_MODEL_ID,
  });
};

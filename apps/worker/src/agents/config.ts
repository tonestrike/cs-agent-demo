import { z } from "zod";

import type { Env } from "../env";

export const agentToneSchema = z.enum(["warm", "neutral", "direct"]);

export const agentConfigSchema = z.object({
  tone: agentToneSchema.default("warm"),
  greeting: z
    .string()
    .default("Hi! Thanks for calling PestCall. How can I help today?"),
  offTopicMessage: z
    .string()
    .default(
      "I can help with pest control appointments, billing, and service questions.",
    ),
  companyName: z.string().default("PestCall"),
});

export type AgentPromptConfig = z.infer<typeof agentConfigSchema>;

export const getAgentConfig = (env: Env): AgentPromptConfig => {
  return agentConfigSchema.parse({
    tone: env.AGENT_TONE,
    greeting: env.AGENT_GREETING,
    offTopicMessage: env.AGENT_OFFTOPIC_MESSAGE,
    companyName: env.AGENT_COMPANY_NAME,
  });
};

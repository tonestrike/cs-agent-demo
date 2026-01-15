import { z } from "zod";

export const crmProviderSchema = z.enum(["mock", "http"]);
export type CrmProvider = z.infer<typeof crmProviderSchema>;

export const agentModelSchema = z.enum(["mock", "workers-ai"]);
export const agentToneSchema = z.enum(["warm", "neutral", "direct"]);

export const envSchema = z.object({
  DB: z.custom<D1Database>(),
  DEMO_AUTH_TOKEN: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
  CRM_PROVIDER: crmProviderSchema.optional(),
  CRM_BASE_URL: z.string().optional(),
  CRM_API_KEY: z.string().optional(),
  AGENT_MODEL: agentModelSchema.optional(),
  AGENT_TONE: agentToneSchema.optional(),
  AGENT_GREETING: z.string().optional(),
  AGENT_OFFTOPIC_MESSAGE: z.string().optional(),
  AGENT_COMPANY_NAME: z.string().optional(),
  AI: z.custom<Ai>().optional(),
  PestCallAgent: z.custom<DurableObjectNamespace>().optional(),
});

export type Env = z.infer<typeof envSchema>;

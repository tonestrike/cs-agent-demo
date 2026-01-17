import { z } from "zod";

const crmProviderSchema = z.enum(["mock", "http"]);
const agentModelSchema = z.enum(["mock", "workers-ai", "openrouter"]);
const agentToneSchema = z.enum(["warm", "neutral", "direct"]);

export const envSchema = z.object({
  DB: z.custom<D1Database>(),
  DEMO_AUTH_TOKEN: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
  CRM_PROVIDER: crmProviderSchema.optional(),
  CRM_BASE_URL: z.string().optional(),
  CRM_API_KEY: z.string().optional(),
  AGENT_MODEL: agentModelSchema.optional(),
  AGENT_INTERPRETER_MODEL: agentModelSchema.optional(),
  AGENT_NARRATOR_MODEL: agentModelSchema.optional(),
  AGENT_TONE: agentToneSchema.optional(),
  AGENT_GREETING: z.string().optional(),
  AGENT_OFFTOPIC_MESSAGE: z.string().optional(),
  AGENT_SCOPE_MESSAGE: z.string().optional(),
  AGENT_COMPANY_NAME: z.string().optional(),
  AGENT_PERSONA_SUMMARY: z.string().optional(),
  AGENT_TOOL_GUIDANCE: z.string().optional(),
  AGENT_MODEL_ID: z.string().optional(),
  AGENT_INTERPRETER_MODEL_ID: z.string().optional(),
  AGENT_NARRATOR_MODEL_ID: z.string().optional(),
  BUILD_ID: z.string().optional(),
  AI: z.custom<Ai>().optional(),
  AI_GATEWAY_ACCOUNT_ID: z.string().optional(),
  AI_GATEWAY_ID: z.string().optional(),
  AI_GATEWAY_TOKEN: z.string().optional(),
  OPENROUTER_TOKEN: z.string().optional(),
  OPENROUTER_REFERER: z.string().optional(),
  OPENROUTER_TITLE: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().optional(),
  CONVERSATION_HUB: z.custom<DurableObjectNamespace>().optional(),
  CONVERSATION_SESSION_V2: z.custom<DurableObjectNamespace>().optional(),
  RESCHEDULE_WORKFLOW: z.custom<Workflow>().optional(),
  VERIFY_WORKFLOW: z.custom<Workflow>().optional(),
  CANCEL_WORKFLOW: z.custom<Workflow>().optional(),
  REALTIMEKIT_ACCOUNT_ID: z.string().optional(),
  REALTIMEKIT_APP_ID: z.string().optional(),
  REALTIMEKIT_MEETING_ID: z.string().optional(),
  REALTIMEKIT_API_TOKEN: z.string().optional(),
  REALTIMEKIT_PRESET_NAME: z.string().optional(),
  REALTIMEKIT_API_BASE_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

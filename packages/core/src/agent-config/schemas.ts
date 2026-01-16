import { z } from "zod";

export const agentToneSchema = z.enum(["warm", "neutral", "direct"]);

export const agentToolGuidanceSchema = z.object({
  getNextAppointment: z
    .string()
    .min(1)
    .default(
      "Use for checking the next scheduled appointment. Include date, time window, and address.",
    ),
  getOpenInvoices: z
    .string()
    .min(1)
    .default(
      "Use for billing questions and balances. Ask for ZIP before sharing details.",
    ),
  rescheduleAppointment: z
    .string()
    .min(1)
    .default(
      "Use to move appointments only after the caller confirms the new time.",
    ),
  escalate: z
    .string()
    .min(1)
    .default(
      "Use when the caller asks for a human or the request is outside scope.",
    ),
});

const defaultToolGuidance = agentToolGuidanceSchema.parse({});

export const agentPromptConfigSchema = z.object({
  tone: agentToneSchema.default("warm"),
  greeting: z
    .string()
    .min(1)
    .default("Hi! Thanks for calling PestCall. How can I help today?"),
  scopeMessage: z
    .string()
    .min(1)
    .default(
      "I can help with pest control appointments, billing, and service questions.",
    ),
  companyName: z.string().min(1).default("PestCall"),
  personaSummary: z
    .string()
    .min(1)
    .default(
      "You are a friendly, capable pest control support agent who speaks clearly and stays concise.",
    ),
  toolGuidance: agentToolGuidanceSchema.default(defaultToolGuidance),
  modelId: z.string().min(1).default("@cf/meta/llama-3.1-8b-instruct"),
});

export const agentPromptConfigRecordSchema = agentPromptConfigSchema.extend({
  updatedAt: z.string().optional(),
});

export const agentPromptConfigUpdateSchema = z.object({
  tone: agentToneSchema.optional(),
  greeting: z.string().min(1).optional(),
  scopeMessage: z.string().min(1).optional(),
  companyName: z.string().min(1).optional(),
  personaSummary: z.string().min(1).optional(),
  toolGuidance: agentToolGuidanceSchema.partial().optional(),
  modelId: z.string().min(1).optional(),
});

export type AgentPromptConfig = z.infer<typeof agentPromptConfigSchema>;
export type AgentPromptConfigRecord = z.infer<
  typeof agentPromptConfigRecordSchema
>;
export type AgentPromptConfigUpdate = z.infer<
  typeof agentPromptConfigUpdateSchema
>;

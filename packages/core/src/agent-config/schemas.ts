import { z } from "zod";

export const agentToneSchema = z.enum(["warm", "neutral", "direct"]);

export const agentToolGuidanceSchema = z.object({
  lookupCustomerByPhone: z
    .string()
    .min(1)
    .default("Use when the caller's phone number is available."),
  lookupCustomerByNameAndZip: z
    .string()
    .min(1)
    .default(
      "Use when phone lookup fails and you have a full name and ZIP code.",
    ),
  lookupCustomerByEmail: z
    .string()
    .min(1)
    .default("Use when the caller provides an email address."),
  verifyAccount: z
    .string()
    .min(1)
    .default(
      "Use to verify ZIP before sharing sensitive details. Never reveal the ZIP.",
    ),
  getNextAppointment: z
    .string()
    .min(1)
    .default(
      "Use for checking the next scheduled appointment. Include date, time window, and address.",
    ),
  listUpcomingAppointments: z
    .string()
    .min(1)
    .default("Use when multiple appointments might exist for a customer."),
  getAppointmentById: z
    .string()
    .min(1)
    .default("Use when the caller references a specific appointment."),
  getOpenInvoices: z
    .string()
    .min(1)
    .default(
      "Use for billing questions and balances. Ask for ZIP before sharing details.",
    ),
  getAvailableSlots: z
    .string()
    .min(1)
    .default("Use to find alternate time slots for rescheduling."),
  rescheduleAppointment: z
    .string()
    .min(1)
    .default(
      "Use to move appointments only after the caller confirms the new time.",
    ),
  createAppointment: z
    .string()
    .min(1)
    .default("Use to request or book a new appointment."),
  getServicePolicy: z
    .string()
    .min(1)
    .default("Use for service policies like pricing, coverage, or prep."),
  crmEscalate: z
    .string()
    .min(1)
    .default(
      "Use to create a ticket when the request needs escalation, and tell the caller you created it.",
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
    .default("Hey there — thanks for calling PestCall. How can I help today?"),
  scopeMessage: z
    .string()
    .min(1)
    .default("I can help with appointments, billing, and service questions."),
  companyName: z.string().min(1).default("PestCall"),
  personaSummary: z
    .string()
    .min(1)
    .default(
      "You are a friendly, conversational pest control support agent. You keep responses concise, ask one clear question at a time, and sound human.",
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

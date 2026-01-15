import { z } from "zod";

export const agentToolNameSchema = z.enum([
  "crm.getNextAppointment",
  "crm.getOpenInvoices",
  "agent.escalate",
  "agent.fallback",
]);

export const agentToolCallSchema = z.object({
  type: z.literal("tool_call"),
  toolName: agentToolNameSchema,
  arguments: z.record(z.unknown()).optional(),
});

export const agentFinalSchema = z.object({
  type: z.literal("final"),
  text: z.string().min(1),
});

export const agentModelOutputSchema = z.union([
  agentToolCallSchema,
  agentFinalSchema,
]);

export type AgentModelOutput = z.infer<typeof agentModelOutputSchema>;

// Tool result schemas
export const appointmentResultSchema = z
  .object({
    date: z.string(),
    timeWindow: z.string(),
    addressSummary: z.string(),
  })
  .nullable();

export const invoicesSummaryResultSchema = z.object({
  balanceCents: z.number().int().nonnegative(),
  invoiceCount: z.number().int().nonnegative().optional(),
});

export const rescheduleResultSchema = z.object({
  date: z.string(),
  timeWindow: z.string(),
});

export const escalateResultSchema = z.object({
  escalated: z.literal(true),
});

// Discriminated union for tool results
export const toolResultSchema = z.discriminatedUnion("toolName", [
  z.object({
    toolName: z.literal("crm.getNextAppointment"),
    result: appointmentResultSchema,
  }),
  z.object({
    toolName: z.literal("crm.getOpenInvoices"),
    result: invoicesSummaryResultSchema,
  }),
  z.object({
    toolName: z.literal("crm.rescheduleAppointment"),
    result: rescheduleResultSchema,
  }),
  z.object({
    toolName: z.literal("agent.escalate"),
    result: escalateResultSchema,
  }),
]);

export type ToolResult = z.infer<typeof toolResultSchema>;

export type AgentModelInput = {
  text: string;
  customer: {
    id: string;
    displayName: string;
    phoneE164: string;
    addressSummary: string;
  };
};

export type AgentResponseInput = {
  text: string;
  customer: {
    id: string;
    displayName: string;
    phoneE164: string;
    addressSummary: string;
  };
} & ToolResult;

export type ModelAdapter = {
  name: "mock" | "workers-ai";
  modelId?: string;
  generate: (input: AgentModelInput) => Promise<AgentModelOutput>;
  respond: (input: AgentResponseInput) => Promise<string>;
};

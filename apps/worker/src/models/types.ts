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

export type AgentModelInput = {
  text: string;
  customer: {
    id: string;
    displayName: string;
    phoneE164: string;
    addressSummary: string;
  };
};

export type ModelAdapter = {
  generate: (input: AgentModelInput) => Promise<AgentModelOutput>;
};

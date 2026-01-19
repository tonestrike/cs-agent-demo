import { z } from "zod";

export const agentMessageInputSchema = z.object({
  callSessionId: z.string().optional(),
  phoneNumber: z.string().min(1),
  text: z.string().min(1),
});

const agentDebugInfoSchema = z.object({
  reason: z.string().min(1),
  rawText: z.string().nullable().optional(),
  provider: z.string().optional(),
  modelId: z.string().nullable().optional(),
  messageCount: z.number().int().optional(),
  toolName: z.string().optional(),
});

export type AgentMessageInput = z.infer<typeof agentMessageInputSchema>;

export const agentMessageOutputSchema = z.object({
  callSessionId: z.string(),
  replyText: z.string(),
  actions: z.array(z.string()),
  ticketId: z.string().optional(),
  debug: agentDebugInfoSchema.optional(),
});

export type AgentMessageOutput = z.infer<typeof agentMessageOutputSchema>;

import type { AgentModelInput, ModelAdapter } from "./types";

const detectTool = (text: string) => {
  const lowered = text.toLowerCase();
  if (
    lowered.includes("agent") ||
    lowered.includes("human") ||
    lowered.includes("representative")
  ) {
    return "agent.escalate" as const;
  }
  if (
    lowered.includes("appointment") ||
    lowered.includes("schedule") ||
    lowered.includes("reschedule")
  ) {
    return "crm.getNextAppointment" as const;
  }
  if (
    lowered.includes("bill") ||
    lowered.includes("invoice") ||
    lowered.includes("balance") ||
    lowered.includes("owe")
  ) {
    return "crm.getOpenInvoices" as const;
  }
  return "agent.fallback" as const;
};

export const createMockModelAdapter = (): ModelAdapter => {
  return {
    async generate(input: AgentModelInput) {
      const toolName = detectTool(input.text);
      if (toolName === "agent.fallback") {
        return {
          type: "final",
          text: "I can help with appointments or billing. What do you need?",
        };
      }
      return {
        type: "tool_call",
        toolName,
        arguments: { customerId: input.customer.id },
      };
    },
  };
};

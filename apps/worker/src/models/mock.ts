import type {
  AgentModelInput,
  AgentResponseInput,
  ModelAdapter,
} from "./types";

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
    name: "mock",
    modelId: "mock",
    async generate(input: AgentModelInput) {
      const combinedText = [input.context, input.text]
        .filter(Boolean)
        .join(" ");
      const toolName = detectTool(combinedText);
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
    async respond(input: AgentResponseInput) {
      switch (input.toolName) {
        case "crm.getNextAppointment": {
          if (!input.result) {
            return "I couldn't find a scheduled appointment.";
          }
          return `Your next appointment is ${input.result.date} ${input.result.timeWindow} at ${input.result.addressSummary}.`;
        }
        case "crm.rescheduleAppointment": {
          return `I moved your appointment. Your new window is ${input.result.date} ${input.result.timeWindow}.`;
        }
        case "crm.getOpenInvoices": {
          const balanceCents = input.result.balanceCents;
          return balanceCents === 0
            ? "You have no outstanding balance."
            : `Your current balance is $${(balanceCents / 100).toFixed(2)}.`;
        }
        case "agent.escalate":
          return "I have created a ticket for a specialist to follow up shortly.";
        default:
          return "Thanks for the details. How else can I help?";
      }
    },
  };
};

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
    async respond(input: AgentResponseInput) {
      switch (input.toolName) {
        case "crm.getNextAppointment": {
          const appointment = input.toolResult as {
            date?: string;
            timeWindow?: string;
            addressSummary?: string;
          };
          if (!appointment?.date || !appointment?.timeWindow) {
            return "I couldn't find a scheduled appointment.";
          }
          return `Your next appointment is ${appointment.date} ${appointment.timeWindow} at ${appointment.addressSummary ?? "your address"}.`;
        }
        case "crm.rescheduleAppointment": {
          const slot = input.toolResult as {
            date?: string;
            timeWindow?: string;
          };
          if (!slot?.date || !slot?.timeWindow) {
            return "I couldn't reschedule the appointment yet.";
          }
          return `I moved your appointment. Your new window is ${slot.date} ${slot.timeWindow}.`;
        }
        case "crm.getOpenInvoices": {
          const balanceCents = Number(input.toolResult.balanceCents ?? 0);
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

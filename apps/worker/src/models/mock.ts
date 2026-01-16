import type { AgentPromptConfig } from "@pestcall/core";
import type {
  AgentModelInput,
  AgentResponseInput,
  ModelAdapter,
} from "./types";

const normalizeConversationText = (text: string) => {
  return text
    .split("\n")
    .map((line) => line.replace(/^(agent|caller):\s*/i, ""))
    .join(" ");
};

const detectTool = (text: string) => {
  const lowered = normalizeConversationText(text).toLowerCase();
  const wantsConfirm =
    lowered.includes("yes") ||
    lowered.includes("sure") ||
    lowered.includes("ok") ||
    lowered.includes("okay");
  if (
    wantsConfirm &&
    (lowered.includes("reschedule") ||
      lowered.includes("available") ||
      lowered.includes("slot"))
  ) {
    return "crm.rescheduleAppointment" as const;
  }
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

export const createMockModelAdapter = (
  config?: AgentPromptConfig,
): ModelAdapter => {
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
        case "agent.message": {
          if (input.result.kind === "request_customer_info") {
            return "Can you share your name and address so I can locate your account?";
          }
          if (input.result.kind === "request_zip") {
            return "Please confirm your ZIP code before I share billing details.";
          }
          if (input.result.kind === "no_appointment") {
            return "I couldn't find a scheduled appointment.";
          }
          if (input.result.kind === "no_slots") {
            return "I couldn't find any alternate times right now.";
          }
          if (input.result.kind === "reschedule_confirmed") {
            return "You're all set. Your appointment has been updated.";
          }
          return (
            config?.scopeMessage ??
            "I can help with pest control appointments, billing, or service questions."
          );
        }
        default:
          return (
            config?.scopeMessage ??
            "I can help with pest control appointments, billing, or service questions."
          );
      }
    },
  };
};

import type { AgentToolName } from "../models/tool-definitions";

type IntentId =
  | "appointments"
  | "reschedule"
  | "cancel"
  | "billing"
  | "payment"
  | "policy";

export type AgentIntentCapability = {
  id: IntentId;
  description: string;
  tools: AgentToolName[];
  preconditions?: string[];
  examples: string[];
};

export const AGENT_CAPABILITIES: AgentIntentCapability[] = [
  {
    id: "appointments",
    description: "Check upcoming or next appointments.",
    tools: [
      "crm.getNextAppointment",
      "crm.listUpcomingAppointments",
    ] satisfies AgentToolName[],
    preconditions: ["verified"],
    examples: ["When's my next service?", "Do I have anything scheduled?"],
  },
  {
    id: "reschedule",
    description: "Move an existing appointment to a new time.",
    tools: [
      "crm.listUpcomingAppointments",
      "crm.getAvailableSlots",
      "crm.rescheduleAppointment",
    ] satisfies AgentToolName[],
    preconditions: ["verified"],
    examples: [
      "Can we move my appointment to tomorrow?",
      "I need a later time.",
    ],
  },
  {
    id: "cancel",
    description: "Cancel an existing appointment.",
    tools: [
      "crm.listUpcomingAppointments",
      "crm.cancelAppointment",
    ] satisfies AgentToolName[],
    preconditions: ["verified"],
    examples: ["Cancel my visit", "I need to cancel Friday"],
  },
  {
    id: "billing",
    description: "Share open balance summaries.",
    tools: ["crm.getOpenInvoices"] satisfies AgentToolName[],
    preconditions: ["verified"],
    examples: ["What's my balance?", "Do I owe anything?"],
  },
  {
    id: "payment",
    description: "Hand off payment requests to a human safely.",
    tools: ["crm.escalate"] satisfies AgentToolName[],
    preconditions: ["verified"],
    examples: ["I want to pay", "Can I clear my balance now?"],
  },
  {
    id: "policy",
    description: "Answer service policy questions.",
    tools: ["crm.getServicePolicy"] satisfies AgentToolName[],
    examples: [
      "What's your cancellation policy?",
      "How do I prep for treatment?",
    ],
  },
];

export const buildCapabilitiesHelpText = () => {
  const lines = AGENT_CAPABILITIES.map(
    (capability) =>
      `- ${capability.id}: ${capability.description}${
        capability.examples.length
          ? ` (e.g., ${capability.examples.slice(0, 2).join("; ")})`
          : ""
      }`,
  );
  return `I can help with:\n${lines.join("\n")}\nIf you'd like, I can also connect you with a person.`;
};

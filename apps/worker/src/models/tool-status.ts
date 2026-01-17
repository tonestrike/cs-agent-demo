import type { AgentToolName } from "./tool-definitions";

type ToolStatusConfig = {
  fallback: string;
  contextHint: string;
  statusHint: string;
};

export const DEFAULT_TOOL_STATUS_MESSAGE =
  "I'm on it—give me a moment. If you'd prefer a person, I can loop one in.";

export const DEFAULT_TOOL_STATUS_HINT = "your request";

const TOOL_STATUS_CONFIG: Partial<Record<AgentToolName, ToolStatusConfig>> = {
  "crm.verifyAccount": {
    fallback: "Thanks - I'll check that ZIP for you now.",
    contextHint:
      "Acknowledge that you're checking the ZIP code in a warm, conversational tone.",
    statusHint: "verification",
  },
  "crm.getNextAppointment": {
    fallback: "Sure - I'm pulling up your next appointment now.",
    contextHint: "Share the next appointment details.",
    statusHint: "next appointment",
  },
  "crm.listUpcomingAppointments": {
    fallback: "Sure - I'm pulling up your upcoming appointments now.",
    contextHint: "Share upcoming appointments and ask next step.",
    statusHint: "next appointment",
  },
  "crm.getAppointmentById": {
    fallback: "Got it. I'm pulling up that appointment now.",
    contextHint: "Share the appointment details or ask for a new choice.",
    statusHint: "appointment details",
  },
  "crm.getOpenInvoices": {
    fallback: "Sure - I'm checking your balance now.",
    contextHint: "Share the balance and invoice status.",
    statusHint: "your balance",
  },
  "crm.getAvailableSlots": {
    fallback: "Got it. I'm checking the next available times now.",
    contextHint:
      "Offer available times and confirm whether the on-file address is correct.",
    statusHint: "available time slots",
  },
  "crm.rescheduleAppointment": {
    fallback:
      "Sure - I can help reschedule. I'm pulling your appointments and options now.",
    contextHint:
      "Acknowledge the reschedule request and say you're getting details.",
    statusHint: "rescheduling your appointment",
  },
  "crm.cancelAppointment": {
    fallback:
      "Sure - I can help cancel that. I'm pulling your appointments now.",
    contextHint:
      "Acknowledge the cancellation request and say you're getting details.",
    statusHint: "cancelling your appointment",
  },
  "crm.createAppointment": {
    fallback: "Got it. I'll check available times and get that set up.",
    contextHint:
      "Acknowledge the scheduling request and say you're checking availability.",
    statusHint: "available time slots",
  },
  "crm.getServicePolicy": {
    fallback: "Sure - I'm pulling that policy now.",
    contextHint: "Share the requested service policy.",
    statusHint: "service policy",
  },
  "crm.escalate": {
    fallback: "I'll connect you with a specialist.",
    contextHint:
      "Confirm that a specialist will follow up and share the ticket id if available.",
    statusHint: "escalation",
  },
  "agent.escalate": {
    fallback: "I'll connect you with a specialist.",
    contextHint:
      "Confirm that a specialist will follow up and share the ticket id if available.",
    statusHint: "escalation",
  },
};

export const getToolStatusConfig = (toolName: string): ToolStatusConfig => {
  const config = TOOL_STATUS_CONFIG[toolName as AgentToolName];
  return (
    config ?? {
      fallback: DEFAULT_TOOL_STATUS_MESSAGE,
      contextHint: "Acknowledge the request briefly while you check.",
      statusHint: DEFAULT_TOOL_STATUS_HINT,
    }
  );
};

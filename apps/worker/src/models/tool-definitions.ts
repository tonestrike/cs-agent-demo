import { z } from "zod";
import {
  type agentToolNameSchema,
  appointmentListResultSchema,
  appointmentResultSchema,
  availableSlotListResultSchema,
  createAppointmentResultSchema,
  crmEscalateResultSchema,
  customerMatchResultSchema,
  escalateResultSchema,
  invoicesSummaryResultSchema,
  rescheduleResultSchema,
  servicePolicyResultSchema,
  verifyAccountResultSchema,
  workflowConfirmResultSchema,
  workflowSelectResultSchema,
} from "./types";

export type AgentToolName = z.infer<typeof agentToolNameSchema>;

type ToolDefinition = {
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  missingArgsMessage: string;
  /**
   * Brief message to show while tool is executing.
   * Can be a string (always show) or a function that receives the domain state
   * and returns string | null (return null to skip acknowledgement if data is cached).
   *
   * Domain-specific logic (e.g., checking for cached appointments) belongs here
   * in the tool definition, not in the agent layer.
   */
  acknowledgement?: string | ((domainState: DomainState) => string | null);
  /** Tool only available after customer account is verified */
  requiresVerification?: boolean;
  /** Tool only available when a workflow is active (e.g., selecting from a list) */
  requiresActiveWorkflow?: boolean;
};

export type ToolGatingState = {
  isVerified: boolean;
  hasActiveWorkflow: boolean;
  allowUnverifiedEscalation?: boolean;
};

/**
 * Domain state passed to conditional acknowledgements.
 * This is the raw domainState from the session - a generic record
 * that tool definitions can inspect to make domain-specific decisions.
 *
 * Note: All domain knowledge lives in tool-definitions.ts (configuration layer),
 * not in the agent itself. The agent passes domainState opaquely.
 */
export type DomainState = Record<string, unknown>;

const fiveDigitZip = z
  .string()
  .regex(/^\d{5}$/)
  .describe("5-digit ZIP code");

export const toolDefinitions: Record<AgentToolName, ToolDefinition> = {
  "crm.lookupCustomerByPhone": {
    description: "Look up a customer by phone number.",
    inputSchema: z.object({
      phoneE164: z
        .string()
        .optional()
        .describe("Phone number in E.164 format (e.g., +15551234567)"),
    }),
    outputSchema: customerMatchResultSchema,
    missingArgsMessage: "A phone number is required to look up the account.",
    acknowledgement: "Got it—pulling up your account now.",
  },
  "crm.lookupCustomerByNameAndZip": {
    description: "Look up a customer by full name and ZIP code.",
    inputSchema: z.object({
      fullName: z.string().min(1).describe("Customer's full name"),
      zipCode: fiveDigitZip,
    }),
    outputSchema: customerMatchResultSchema,
    missingArgsMessage:
      "Full name and a 5-digit ZIP code are required to look up the account.",
    acknowledgement: "Thanks—checking your account details now.",
  },
  "crm.lookupCustomerByEmail": {
    description: "Look up a customer by email address.",
    inputSchema: z.object({
      email: z.string().email().describe("Customer's email address"),
    }),
    outputSchema: customerMatchResultSchema,
    missingArgsMessage:
      "A valid email address is required to look up the account.",
    acknowledgement: "On it—searching for your account by email.",
  },
  "crm.verifyAccount": {
    description:
      "Verify a customer account using their ZIP code. Call this when the customer provides their ZIP code.",
    inputSchema: z.object({
      customerId: z
        .string()
        .optional()
        .describe("Customer ID if known, otherwise omit"),
      zipCode: z
        .string()
        .regex(/^\d{5}$/)
        .describe("5-digit ZIP code provided by the customer"),
    }),
    outputSchema: verifyAccountResultSchema,
    missingArgsMessage:
      "Please provide a 5-digit ZIP code to verify the account.",
    acknowledgement: "Got it—verifying your account now.",
  },
  "crm.getNextAppointment": {
    description: "Fetch the next scheduled appointment for the customer.",
    inputSchema: z.object({
      customerId: z
        .string()
        .optional()
        .describe("Customer ID (auto-populated from session)"),
    }),
    outputSchema: appointmentResultSchema,
    missingArgsMessage: "Customer ID is required to load appointments.",
    requiresVerification: true,
    acknowledgement: (domainState) => {
      const conversation = domainState["conversation"] as
        | { appointments?: unknown[] }
        | undefined;
      const hasAppointments = Boolean(conversation?.appointments?.length);
      return hasAppointments ? null : "Pulling up your next appointment...";
    },
  },
  "crm.listUpcomingAppointments": {
    description:
      "List all upcoming appointments for the customer. Use this to see what appointments they have scheduled.",
    inputSchema: z.object({
      customerId: z
        .string()
        .optional()
        .describe("Customer ID (auto-populated from session)"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of appointments to return"),
    }),
    outputSchema: appointmentListResultSchema,
    missingArgsMessage: "Customer ID is required to list appointments.",
    requiresVerification: true,
    acknowledgement: (domainState) => {
      const conversation = domainState["conversation"] as
        | { appointments?: unknown[] }
        | undefined;
      const hasAppointments = Boolean(conversation?.appointments?.length);
      return hasAppointments ? null : "Let me list your upcoming appointments.";
    },
  },
  "crm.getAppointmentById": {
    description: "Fetch a specific appointment by its ID.",
    inputSchema: z.object({
      appointmentId: z.string().min(1).describe("Unique appointment ID"),
    }),
    outputSchema: appointmentResultSchema,
    missingArgsMessage: "Appointment ID is required to load that appointment.",
    requiresVerification: true,
    acknowledgement: (domainState) => {
      const conversation = domainState["conversation"] as
        | { appointments?: unknown[] }
        | undefined;
      const hasAppointments = Boolean(conversation?.appointments?.length);
      return hasAppointments ? null : "Checking that appointment now.";
    },
  },
  "crm.getOpenInvoices": {
    description: "Fetch open invoices for a customer.",
    inputSchema: z.object({
      customerId: z
        .string()
        .optional()
        .describe("Customer ID (auto-populated from session)"),
    }),
    outputSchema: invoicesSummaryResultSchema,
    missingArgsMessage: "Customer ID is required to look up invoices.",
    requiresVerification: true,
    acknowledgement: "Reviewing your invoices now.",
  },
  "crm.getAvailableSlots": {
    description: "Fetch available appointment slots for rescheduling.",
    inputSchema: z.object({
      appointmentId: z
        .string()
        .optional()
        .describe("ID of appointment being rescheduled"),
      customerId: z
        .string()
        .optional()
        .describe("Customer ID (auto-populated from session)"),
      daysAhead: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of days to look ahead for slots"),
      fromDate: z.string().optional().describe("Start date for slot search"),
      toDate: z.string().optional().describe("End date for slot search"),
      preference: z
        .enum(["morning", "afternoon", "any"])
        .optional()
        .describe("Time of day preference"),
    }),
    outputSchema: availableSlotListResultSchema,
    missingArgsMessage: "Customer ID is required to look up available slots.",
    requiresVerification: true,
    acknowledgement: (domainState) => {
      const availableSlots = domainState["availableSlots"] as
        | unknown[]
        | undefined;
      const hasSlots = Boolean(availableSlots?.length);
      return hasSlots ? null : "Looking up available time windows for you.";
    },
  },
  "crm.rescheduleAppointment": {
    description: "Reschedule an appointment to a new time slot.",
    inputSchema: z.object({
      appointmentId: z
        .string()
        .min(1)
        .describe("ID of appointment to reschedule"),
      slotId: z.string().min(1).describe("ID of new time slot"),
    }),
    outputSchema: rescheduleResultSchema,
    missingArgsMessage:
      "Which appointment should I reschedule, and which time works best? If you have multiple appointments, I can list them.",
    requiresVerification: true,
    acknowledgement: "Got it—rescheduling that appointment now.",
  },
  "crm.cancelAppointment": {
    description:
      "Cancel a scheduled appointment. Call this when the customer confirms they want to cancel.",
    inputSchema: z.object({
      appointmentId: z.string().min(1).describe("ID of appointment to cancel"),
    }),
    outputSchema: z.object({ ok: z.boolean() }),
    missingArgsMessage:
      "Which appointment should I cancel? If you have multiple appointments, I can list them.",
    requiresVerification: true,
    acknowledgement: "Understood—cancelling that appointment.",
  },
  "crm.createAppointment": {
    description: "Create a new appointment for a customer.",
    inputSchema: z.object({
      customerId: z
        .string()
        .optional()
        .describe("Customer ID (auto-populated from session)"),
      preferredWindow: z
        .string()
        .min(1)
        .describe("Preferred time window for the appointment"),
      notes: z
        .string()
        .optional()
        .describe("Additional notes for the appointment"),
      pestType: z.string().optional().describe("Type of pest issue"),
    }),
    outputSchema: createAppointmentResultSchema,
    missingArgsMessage:
      "Customer ID and preferred window are required to create an appointment.",
    requiresVerification: true,
    acknowledgement: "I'll schedule that appointment now.",
  },
  "crm.getServicePolicy": {
    description:
      "Fetch service policy information by topic (e.g., cancellation, pricing, guarantees).",
    inputSchema: z.object({
      topic: z
        .string()
        .min(1)
        .describe("Policy topic to look up (e.g., cancellation, pricing)"),
    }),
    outputSchema: servicePolicyResultSchema,
    missingArgsMessage: "A policy topic is required.",
    acknowledgement: "Checking that policy for you.",
  },
  "crm.escalate": {
    description: "Escalate a request and create a support ticket.",
    inputSchema: z.object({
      reason: z.string().optional().describe("Reason for escalation"),
      summary: z.string().optional().describe("Brief summary of the issue"),
      message: z
        .string()
        .optional()
        .describe("Detailed message for the support team"),
    }),
    outputSchema: crmEscalateResultSchema,
    missingArgsMessage: "Escalation details are required.",
    requiresVerification: true,
    acknowledgement: "I'll connect you with a specialist to help.",
  },
  "agent.escalate": {
    description: "Escalate to a human agent.",
    inputSchema: z.object({
      reason: z.string().optional().describe("Reason for escalation"),
      summary: z.string().optional().describe("Brief summary of the issue"),
      message: z.string().optional().describe("Detailed message for the agent"),
    }),
    outputSchema: escalateResultSchema,
    missingArgsMessage: "Escalation details are required.",
    requiresVerification: true,
    acknowledgement: "I'll bring in a specialist to assist.",
  },
  "agent.fallback": {
    description: "Fallback tool for out-of-scope requests.",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    missingArgsMessage: "Missing or invalid tool arguments.",
  },
  // Workflow selection tools - available when a workflow is active
  "workflow.selectAppointment": {
    description:
      "Select an appointment from a list of options. Use when customer indicates which appointment they want to reschedule, cancel, or view.",
    inputSchema: z.object({
      selectionIndex: z
        .number()
        .int()
        .nonnegative()
        .describe("Zero-based index of the appointment in the current list"),
      appointmentId: z.string().optional().describe("Direct ID if known"),
    }),
    outputSchema: workflowSelectResultSchema,
    missingArgsMessage:
      "Which appointment would you like to select? You can say the number or describe it.",
    requiresActiveWorkflow: true,
  },
  "workflow.selectSlot": {
    description:
      "Select a time slot from available options. Use when customer indicates their preferred appointment time.",
    inputSchema: z.object({
      selectionIndex: z
        .number()
        .int()
        .nonnegative()
        .describe("Zero-based index of the slot in the current list"),
      slotId: z.string().optional().describe("Direct slot ID if known"),
    }),
    outputSchema: workflowSelectResultSchema,
    missingArgsMessage:
      "Which time slot works best for you? You can say the number or describe the time.",
    requiresActiveWorkflow: true,
  },
  "workflow.confirm": {
    description:
      "Confirm or cancel a pending action. Use when customer confirms or declines a proposed action like cancellation or rescheduling.",
    inputSchema: z.object({
      confirmed: z
        .boolean()
        .describe("True if customer confirms, false if they decline"),
    }),
    outputSchema: workflowConfirmResultSchema,
    missingArgsMessage: "Would you like me to proceed with that?",
    requiresActiveWorkflow: true,
  },
};

export const validateToolArgs = (
  toolName: AgentToolName,
  args: Record<string, unknown> | undefined,
) => {
  const definition = toolDefinitions[toolName];
  const parsed = definition.inputSchema.safeParse(args ?? {});
  if (parsed.success) {
    return {
      ok: true as const,
      data: parsed.data,
      message: definition.missingArgsMessage,
    };
  }
  return {
    ok: false as const,
    data: args ?? {},
    message: definition.missingArgsMessage,
  };
};

export const validateToolResult = (
  toolName: AgentToolName,
  result: unknown,
) => {
  const definition = toolDefinitions[toolName];
  const parsed = definition.outputSchema.safeParse(result);
  if (parsed.success) {
    return { ok: true as const };
  }
  return { ok: false as const };
};

/**
 * Filter available tools based on current session state.
 * Tools with gating requirements are excluded if conditions aren't met.
 */
export const getAvailableTools = (
  state: ToolGatingState,
): Partial<Record<AgentToolName, ToolDefinition>> => {
  const available: Partial<Record<AgentToolName, ToolDefinition>> = {};

  for (const [name, definition] of Object.entries(toolDefinitions)) {
    const toolName = name as AgentToolName;

    // Check verification requirement
    if (
      definition.requiresVerification &&
      !state.isVerified &&
      !(toolName === "agent.escalate" && state.allowUnverifiedEscalation)
    ) {
      continue;
    }

    // Check active workflow requirement
    if (definition.requiresActiveWorkflow && !state.hasActiveWorkflow) {
      continue;
    }

    available[toolName] = definition;
  }

  return available;
};

/**
 * Get tool names available for the current state.
 * Convenience wrapper for getAvailableTools.
 */
export const getAvailableToolNames = (
  state: ToolGatingState,
): AgentToolName[] => {
  return Object.keys(getAvailableTools(state)) as AgentToolName[];
};

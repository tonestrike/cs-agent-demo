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
  /** Brief message to show while tool is executing (e.g., "Looking up your appointments...") */
  acknowledgement?: string;
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

const fiveDigitZip = z.string().regex(/^\d{5}$/);

export const toolDefinitions: Record<AgentToolName, ToolDefinition> = {
  "crm.lookupCustomerByPhone": {
    description: "Look up a customer by phone number.",
    inputSchema: z.object({ phoneE164: z.string().optional() }),
    outputSchema: customerMatchResultSchema,
    missingArgsMessage: "A phone number is required to look up the account.",
    acknowledgement: "Got it—pulling up your account now.",
  },
  "crm.lookupCustomerByNameAndZip": {
    description: "Look up a customer by full name and ZIP code.",
    inputSchema: z.object({
      fullName: z.string().min(1),
      zipCode: fiveDigitZip,
    }),
    outputSchema: customerMatchResultSchema,
    missingArgsMessage:
      "Full name and a 5-digit ZIP code are required to look up the account.",
    acknowledgement: "Thanks—checking your account details now.",
  },
  "crm.lookupCustomerByEmail": {
    description: "Look up a customer by email address.",
    inputSchema: z.object({ email: z.string().email() }),
    outputSchema: customerMatchResultSchema,
    missingArgsMessage:
      "A valid email address is required to look up the account.",
    acknowledgement: "On it—searching for your account by email.",
  },
  "crm.verifyAccount": {
    description: "Verify a customer account with ZIP code.",
    inputSchema: z.object({
      customerId: z.string().optional(),
      zipCode: fiveDigitZip,
    }),
    outputSchema: verifyAccountResultSchema,
    missingArgsMessage:
      "Please provide a 5-digit ZIP code to verify the account.",
  },
  "crm.getNextAppointment": {
    description: "Fetch the next scheduled appointment.",
    inputSchema: z.object({ customerId: z.string().optional() }),
    outputSchema: appointmentResultSchema,
    missingArgsMessage: "Customer ID is required to load appointments.",
    requiresVerification: true,
    acknowledgement: "Pulling up your next appointment...",
  },
  "crm.listUpcomingAppointments": {
    description: "List upcoming appointments for a customer.",
    inputSchema: z.object({
      customerId: z.string().optional(),
      limit: z.number().int().positive().optional(),
    }),
    outputSchema: appointmentListResultSchema,
    missingArgsMessage: "Customer ID is required to list appointments.",
    requiresVerification: true,
    acknowledgement: "Let me list your upcoming appointments.",
  },
  "crm.getAppointmentById": {
    description: "Fetch a specific appointment by ID.",
    inputSchema: z.object({ appointmentId: z.string().min(1) }),
    outputSchema: appointmentResultSchema,
    missingArgsMessage: "Appointment ID is required to load that appointment.",
    requiresVerification: true,
    acknowledgement: "Checking that appointment now.",
  },
  "crm.getOpenInvoices": {
    description: "Fetch open invoices for a customer.",
    inputSchema: z.object({ customerId: z.string().optional() }),
    outputSchema: invoicesSummaryResultSchema,
    missingArgsMessage: "Customer ID is required to look up invoices.",
    requiresVerification: true,
    acknowledgement: "Reviewing your invoices now.",
  },
  "crm.getAvailableSlots": {
    description: "Fetch available appointment slots for a customer.",
    inputSchema: z.object({
      appointmentId: z.string().optional(),
      customerId: z.string().optional(),
      daysAhead: z.number().int().positive().optional(),
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
      preference: z.enum(["morning", "afternoon", "any"]).optional(),
    }),
    outputSchema: availableSlotListResultSchema,
    missingArgsMessage: "Customer ID is required to look up available slots.",
    requiresVerification: true,
    acknowledgement: "Looking up available time windows for you.",
  },
  "crm.rescheduleAppointment": {
    description: "Reschedule an appointment to a chosen slot.",
    inputSchema: z.object({
      appointmentId: z.string().min(1),
      slotId: z.string().min(1),
    }),
    outputSchema: rescheduleResultSchema,
    missingArgsMessage:
      "Which appointment should I reschedule, and which time works best? If you have multiple appointments, I can list them.",
    requiresVerification: true,
    acknowledgement: "Got it—rescheduling that appointment now.",
  },
  "crm.cancelAppointment": {
    description: "Cancel a scheduled appointment.",
    inputSchema: z.object({
      appointmentId: z.string().min(1),
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
      customerId: z.string().optional(),
      preferredWindow: z.string().min(1),
      notes: z.string().optional(),
      pestType: z.string().optional(),
    }),
    outputSchema: createAppointmentResultSchema,
    missingArgsMessage:
      "Customer ID and preferred window are required to create an appointment.",
    requiresVerification: true,
    acknowledgement: "I'll schedule that appointment now.",
  },
  "crm.getServicePolicy": {
    description: "Fetch a service policy by topic.",
    inputSchema: z.object({ topic: z.string().min(1) }),
    outputSchema: servicePolicyResultSchema,
    missingArgsMessage: "A policy topic is required.",
    acknowledgement: "Checking that policy for you.",
  },
  "crm.escalate": {
    description: "Escalate a request and create a ticket.",
    inputSchema: z.object({
      reason: z.string().optional(),
      summary: z.string().optional(),
      message: z.string().optional(),
    }),
    outputSchema: crmEscalateResultSchema,
    missingArgsMessage: "Escalation details are required.",
    requiresVerification: true,
    acknowledgement: "I'll connect you with a specialist to help.",
  },
  "agent.escalate": {
    description: "Escalate to a human agent.",
    inputSchema: z.object({
      reason: z.string().optional(),
      summary: z.string().optional(),
      message: z.string().optional(),
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

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
} from "./types";

export type AgentToolName = z.infer<typeof agentToolNameSchema>;

type ToolDefinition = {
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  missingArgsMessage: string;
};

const fiveDigitZip = z.string().regex(/^\d{5}$/);

export const toolDefinitions: Record<AgentToolName, ToolDefinition> = {
  "crm.lookupCustomerByPhone": {
    description: "Look up a customer by phone number.",
    inputSchema: z.object({ phoneE164: z.string().optional() }),
    outputSchema: customerMatchResultSchema,
    missingArgsMessage: "A phone number is required to look up the account.",
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
  },
  "crm.lookupCustomerByEmail": {
    description: "Look up a customer by email address.",
    inputSchema: z.object({ email: z.string().email() }),
    outputSchema: customerMatchResultSchema,
    missingArgsMessage:
      "A valid email address is required to look up the account.",
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
  },
  "crm.listUpcomingAppointments": {
    description: "List upcoming appointments for a customer.",
    inputSchema: z.object({
      customerId: z.string().optional(),
      limit: z.number().int().positive().optional(),
    }),
    outputSchema: appointmentListResultSchema,
    missingArgsMessage: "Customer ID is required to list appointments.",
  },
  "crm.getAppointmentById": {
    description: "Fetch a specific appointment by ID.",
    inputSchema: z.object({ appointmentId: z.string().min(1) }),
    outputSchema: appointmentResultSchema,
    missingArgsMessage: "Appointment ID is required to load that appointment.",
  },
  "crm.getOpenInvoices": {
    description: "Fetch open invoices for a customer.",
    inputSchema: z.object({ customerId: z.string().optional() }),
    outputSchema: invoicesSummaryResultSchema,
    missingArgsMessage: "Customer ID is required to look up invoices.",
  },
  "crm.getAvailableSlots": {
    description: "Fetch available appointment slots for a customer.",
    inputSchema: z.object({
      customerId: z.string().optional(),
      daysAhead: z.number().int().positive().optional(),
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
      preference: z.enum(["morning", "afternoon", "any"]).optional(),
    }),
    outputSchema: availableSlotListResultSchema,
    missingArgsMessage: "Customer ID is required to look up available slots.",
  },
  "crm.rescheduleAppointment": {
    description: "Reschedule an appointment to a chosen slot.",
    inputSchema: z.object({
      appointmentId: z.string().min(1),
      slotId: z.string().min(1),
    }),
    outputSchema: rescheduleResultSchema,
    missingArgsMessage:
      "Appointment ID and slot ID are required to reschedule.",
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
  },
  "crm.getServicePolicy": {
    description: "Fetch a service policy by topic.",
    inputSchema: z.object({ topic: z.string().min(1) }),
    outputSchema: servicePolicyResultSchema,
    missingArgsMessage: "A policy topic is required.",
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
  },
  "agent.fallback": {
    description: "Fallback tool for out-of-scope requests.",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    missingArgsMessage: "Missing or invalid tool arguments.",
  },
};

export const aiTools = Object.fromEntries(
  Object.entries(toolDefinitions).map(([name, definition]) => [
    name,
    {
      description: definition.description,
      parameters: definition.inputSchema,
    },
  ]),
) as Record<
  AgentToolName,
  {
    description: string;
    parameters: z.ZodTypeAny;
  }
>;

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

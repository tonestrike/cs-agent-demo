import { z } from "zod";

export const agentToolNameSchema = z.enum([
  "crm.lookupCustomerByPhone",
  "crm.lookupCustomerByNameAndZip",
  "crm.lookupCustomerByEmail",
  "crm.verifyAccount",
  "crm.getNextAppointment",
  "crm.listUpcomingAppointments",
  "crm.getAppointmentById",
  "crm.getOpenInvoices",
  "crm.getAvailableSlots",
  "crm.rescheduleAppointment",
  "crm.cancelAppointment",
  "crm.createAppointment",
  "crm.getServicePolicy",
  "crm.escalate",
  "agent.escalate",
  "agent.fallback",
]);

export const agentToolCallSchema = z.object({
  type: z.literal("tool_call"),
  toolName: agentToolNameSchema,
  arguments: z.record(z.unknown()).optional(),
  acknowledgement: z.string().optional(),
});

export const agentFinalSchema = z.object({
  type: z.literal("final"),
  text: z.string().min(1),
});

export const agentModelOutputSchema = z.union([
  agentToolCallSchema,
  agentFinalSchema,
]);

export type AgentModelOutput = z.infer<typeof agentModelOutputSchema>;

export const actionPreconditionSchema = z.enum([
  "verified",
  "has_appointments",
  "has_available_slots",
  "pending_cancellation",
]);

export type ActionPrecondition = z.infer<typeof actionPreconditionSchema>;

export const actionPlanSchema = z.object({
  kind: z.literal("tool"),
  toolName: agentToolNameSchema,
  arguments: z.record(z.unknown()).optional(),
  required: z.array(actionPreconditionSchema).optional(),
});

export type ActionPlan = z.infer<typeof actionPlanSchema>;

export const agentRouteSchema = z.object({
  intent: z.enum([
    "appointments",
    "reschedule",
    "cancel",
    "billing",
    "payment",
    "policy",
    "general",
  ]),
  topic: z.string().optional(),
  reasoning: z.string().optional(),
});

export type AgentRouteDecision = z.infer<typeof agentRouteSchema>;

// Tool result schemas
export const appointmentResultSchema = z
  .object({
    date: z.string(),
    timeWindow: z.string(),
    addressSummary: z.string(),
    addressId: z.string().optional(),
  })
  .nullable();

export const appointmentListResultSchema = z.array(
  z.object({
    id: z.string(),
    customerId: z.string(),
    addressId: z.string().optional(),
    date: z.string(),
    timeWindow: z.string(),
    addressSummary: z.string(),
  }),
);

export const invoicesSummaryResultSchema = z.object({
  balanceCents: z.number().int().nonnegative(),
  balance: z
    .string()
    .regex(/^\d+\.\d{2}$/)
    .optional(),
  currency: z.string().min(1).optional(),
  invoiceCount: z.number().int().nonnegative().optional(),
});

export const rescheduleResultSchema = z.object({
  date: z.string(),
  timeWindow: z.string(),
});

export const cancelAppointmentResultSchema = z.object({
  ok: z.boolean(),
});

export const availableSlotResultSchema = z.object({
  date: z.string(),
  timeWindow: z.string(),
});

export const availableSlotListResultSchema = z.array(availableSlotResultSchema);

export const customerMatchResultSchema = z.array(
  z.object({
    id: z.string(),
    displayName: z.string(),
    phoneE164: z.string(),
    addressSummary: z.string(),
    zipCode: z.string().optional(),
    email: z.string().optional(),
    addresses: z
      .array(
        z.object({
          addressId: z.string(),
          addressSummary: z.string(),
          zipCode: z.string(),
        }),
      )
      .optional(),
  }),
);

export const verifyAccountResultSchema = z.object({
  ok: z.boolean(),
});

export const servicePolicyResultSchema = z.object({
  text: z.string(),
});

export const createAppointmentResultSchema = z.object({
  ok: z.boolean(),
  appointmentId: z.string().optional(),
});

export const escalateResultSchema = z.object({
  escalated: z.literal(true),
});

export const crmEscalateResultSchema = z.object({
  ok: z.boolean(),
  ticketId: z.string().optional(),
});

export const agentMessageResultSchema = z.object({
  kind: z.string().min(1),
  details: z.string().optional(),
  options: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
      }),
    )
    .optional(),
});

// Discriminated union for tool results
export const toolResultSchema = z.discriminatedUnion("toolName", [
  z.object({
    toolName: z.literal("crm.lookupCustomerByPhone"),
    result: customerMatchResultSchema,
  }),
  z.object({
    toolName: z.literal("crm.lookupCustomerByNameAndZip"),
    result: customerMatchResultSchema,
  }),
  z.object({
    toolName: z.literal("crm.lookupCustomerByEmail"),
    result: customerMatchResultSchema,
  }),
  z.object({
    toolName: z.literal("crm.verifyAccount"),
    result: verifyAccountResultSchema,
  }),
  z.object({
    toolName: z.literal("crm.getNextAppointment"),
    result: appointmentResultSchema,
  }),
  z.object({
    toolName: z.literal("crm.listUpcomingAppointments"),
    result: appointmentListResultSchema,
  }),
  z.object({
    toolName: z.literal("crm.getAppointmentById"),
    result: appointmentResultSchema,
  }),
  z.object({
    toolName: z.literal("crm.getAvailableSlots"),
    result: availableSlotListResultSchema,
  }),
  z.object({
    toolName: z.literal("crm.getOpenInvoices"),
    result: invoicesSummaryResultSchema,
  }),
  z.object({
    toolName: z.literal("crm.rescheduleAppointment"),
    result: rescheduleResultSchema,
  }),
  z.object({
    toolName: z.literal("crm.cancelAppointment"),
    result: cancelAppointmentResultSchema,
  }),
  z.object({
    toolName: z.literal("crm.createAppointment"),
    result: createAppointmentResultSchema,
  }),
  z.object({
    toolName: z.literal("crm.getServicePolicy"),
    result: servicePolicyResultSchema,
  }),
  z.object({
    toolName: z.literal("crm.escalate"),
    result: crmEscalateResultSchema,
  }),
  z.object({
    toolName: z.literal("agent.escalate"),
    result: escalateResultSchema,
  }),
  z.object({
    toolName: z.literal("agent.message"),
    result: agentMessageResultSchema,
  }),
]);

export type ToolResult = z.infer<typeof toolResultSchema>;

export type AgentModelInput = {
  text: string;
  customer: {
    id: string;
    displayName: string;
    phoneE164: string;
    addressSummary: string;
  };
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  context?: string;
  hasContext?: boolean;
};

export type AgentResponseInput = {
  text: string;
  customer: {
    id: string;
    displayName: string;
    phoneE164: string;
    addressSummary: string;
  };
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  context?: string;
  hasContext?: boolean;
} & ToolResult;

export type SelectionOption = {
  id: string;
  label: string;
};

export type SelectionInput = {
  text: string;
  options: SelectionOption[];
  kind: "appointment" | "slot" | "confirmation";
};

export type SelectionResult = {
  selectedId: string | null;
  index: number | null;
  reason?: string;
};

export type StatusInput = {
  text: string;
  contextHint?: string;
  context?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
};

export type ModelAdapter = {
  name: "mock" | "workers-ai" | "openrouter" | "hybrid" | "split";
  modelId?: string;
  generate: (input: AgentModelInput) => Promise<AgentModelOutput>;
  respond: (input: AgentResponseInput) => Promise<string>;
  respondStream?: (input: AgentResponseInput) => AsyncIterable<string>;
  route: (input: AgentModelInput) => Promise<AgentRouteDecision>;
  selectOption: (input: SelectionInput) => Promise<SelectionResult>;
  status: (input: StatusInput) => Promise<string>;
};

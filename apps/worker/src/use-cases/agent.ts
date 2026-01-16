import { normalizePhoneE164 } from "@pestcall/core";
import type { Dependencies } from "../context";
import type { ModelAdapter, ToolResult } from "../models/types";
import type { AgentMessageInput, AgentMessageOutput } from "../schemas/agent";
import { createTicketUseCase } from "./tickets";

type ToolCall = {
  toolName: string;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
};

type ModelCall = {
  modelName: string;
  modelId?: string;
  kind: "decide" | "respond";
  latencyMs: number;
  success: boolean;
  errorCode?: string;
};

const recordToolCall = async <T>(
  toolName: string,
  call: () => Promise<T>,
): Promise<{ result: T; record: ToolCall }> => {
  const start = Date.now();
  try {
    const result = await call();
    return {
      result,
      record: {
        toolName,
        latencyMs: Date.now() - start,
        success: true,
      },
    };
  } catch (error) {
    return {
      result: error as T,
      record: {
        toolName,
        latencyMs: Date.now() - start,
        success: false,
        errorCode: error instanceof Error ? error.message : "unknown",
      },
    };
  }
};

const recordModelCall = async <T>(
  model: { name: string; modelId?: string },
  kind: ModelCall["kind"],
  call: () => Promise<T>,
): Promise<{ result: T; record: ModelCall }> => {
  const start = Date.now();
  try {
    const result = await call();
    return {
      result,
      record: {
        modelName: model.name,
        modelId: model.modelId,
        kind,
        latencyMs: Date.now() - start,
        success: true,
      },
    };
  } catch (error) {
    return {
      result: error as T,
      record: {
        modelName: model.name,
        modelId: model.modelId,
        kind,
        latencyMs: Date.now() - start,
        success: false,
        errorCode: error instanceof Error ? error.message : "unknown",
      },
    };
  }
};

const buildCustomerContext = (customer: {
  id: string;
  displayName: string;
  phoneE164: string;
  addressSummary: string;
}) => ({
  id: customer.id,
  displayName: customer.displayName,
  phoneE164: customer.phoneE164,
  addressSummary: customer.addressSummary,
});

const formatMatches = (
  matches: Array<{
    id: string;
    displayName: string;
    addressSummary: string;
    email?: string;
  }>,
) => {
  if (matches.length === 0) {
    return "none";
  }
  return matches
    .map((match) => {
      const email = match.email ? ` ${match.email}` : "";
      return `${match.id} ${match.displayName} ${match.addressSummary}${email}`.trim();
    })
    .join(" | ");
};

type CallSessionSummary = {
  identityStatus?: "unknown" | "pending" | "verified";
  verifiedCustomerId?: string | null;
  lastToolName?: string | null;
  lastToolResult?: string | null;
};

const parseSummary = (summary: string | null) => {
  if (!summary) {
    return { identityStatus: "unknown" } satisfies CallSessionSummary;
  }
  try {
    const parsed = JSON.parse(summary) as CallSessionSummary;
    return {
      identityStatus: parsed.identityStatus ?? "unknown",
      verifiedCustomerId: parsed.verifiedCustomerId ?? null,
      lastToolName: parsed.lastToolName ?? null,
      lastToolResult: parsed.lastToolResult ?? null,
    };
  } catch {
    return { identityStatus: "unknown" } satisfies CallSessionSummary;
  }
};

const buildSummary = (summary: CallSessionSummary) =>
  JSON.stringify({
    identityStatus: summary.identityStatus ?? "unknown",
    verifiedCustomerId: summary.verifiedCustomerId ?? null,
    lastToolName: summary.lastToolName ?? null,
    lastToolResult: summary.lastToolResult ?? null,
  });

const stringifyToolResult = (result: ToolResult) => {
  try {
    const text = JSON.stringify(result);
    return text.length > 800 ? `${text.slice(0, 800)}…` : text;
  } catch {
    return null;
  }
};

const getStringArg = (args: Record<string, unknown>, key: string) => {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
};

const getNumberArg = (args: Record<string, unknown>, key: string) => {
  const value = args[key];
  return typeof value === "number" ? value : undefined;
};

const generateReply = async (
  model: ModelAdapter,
  input: AgentMessageInput,
  customer: {
    id: string;
    displayName: string;
    phoneE164: string;
    addressSummary: string;
  },
  toolResult: ToolResult,
  fallbackText: string,
  context: string,
  modelCalls: ModelCall[],
  messages: Array<{ role: "user" | "assistant"; content: string }>,
) => {
  const responseCall = await recordModelCall(model, "respond", () =>
    model.respond({
      text: input.text,
      customer: buildCustomerContext(customer),
      messages,
      context,
      hasContext: messages.length > 1,
      ...toolResult,
    }),
  );
  modelCalls.push(responseCall.record);

  if (responseCall.record.success) {
    return responseCall.result;
  }

  try {
    throw responseCall.result;
  } catch {
    return fallbackText;
  }
};

export const handleAgentMessage = async (
  deps: Dependencies,
  input: AgentMessageInput,
  nowIso = new Date().toISOString(),
): Promise<AgentMessageOutput> => {
  const phoneE164 = normalizePhoneE164(input.phoneNumber);
  const tools: ToolCall[] = [];
  const modelCalls: ModelCall[] = [];
  const agentConfig = await deps.agentConfig.get(deps.agentConfigDefaults);
  const model = deps.modelFactory(agentConfig);

  let callSessionId = input.callSessionId;
  let contextTurns = 0;
  let recentTurns: Array<{ speaker: string; text: string }> = [];
  let summary: CallSessionSummary = { identityStatus: "unknown" };
  if (!callSessionId) {
    callSessionId = crypto.randomUUID();
    await deps.calls.createSession({
      id: callSessionId,
      startedAt: nowIso,
      phoneE164,
      status: "active",
      transport: "web",
      summary: buildSummary(summary),
    });
  } else {
    const session = await deps.calls.getSession(callSessionId);
    summary = parseSummary(session?.summary ?? null);
    recentTurns = await deps.calls.getRecentTurns({ callSessionId });
    contextTurns = recentTurns.length;
  }

  await deps.calls.addTurn({
    id: crypto.randomUUID(),
    callSessionId,
    ts: nowIso,
    speaker: "caller",
    text: input.text,
    meta: {},
  });

  const lookup = await recordToolCall("crm.lookupCustomerByPhone", () =>
    deps.crm.lookupCustomerByPhone(phoneE164),
  );
  tools.push(lookup.record);

  const matches = Array.isArray(lookup.result) ? lookup.result : [];
  const actions: string[] = [];
  const resolvedCustomer = matches.length === 1 ? matches[0] : null;
  const customer = resolvedCustomer ?? {
    id: "unknown",
    displayName: "Unknown caller",
    phoneE164,
    addressSummary: "Unknown",
  };

  const systemContext = [
    "System context:",
    `Phone lookup matches: ${formatMatches(matches)}`,
    `Identity status: ${summary.identityStatus ?? "unknown"}`,
    summary.verifiedCustomerId
      ? `Verified customer: ${summary.verifiedCustomerId}`
      : "Verified customer: none",
    summary.lastToolName ? `Last tool: ${summary.lastToolName}` : null,
    summary.lastToolResult
      ? `Last tool result: ${summary.lastToolResult}`
      : null,
  ];
  const context = systemContext.filter(Boolean).join("\n");

  const messageHistory: Array<{ role: "user" | "assistant"; content: string }> =
    recentTurns.map((turn) => ({
      role: turn.speaker === "agent" ? "assistant" : "user",
      content: turn.text,
    }));
  messageHistory.push({ role: "user", content: input.text });

  const modelDecision = await recordModelCall(model, "decide", () =>
    model.generate({
      text: input.text,
      customer: buildCustomerContext(customer),
      messages: messageHistory,
      context,
      hasContext: messageHistory.length > 1,
    }),
  );
  modelCalls.push(modelDecision.record);

  if (!modelDecision.record.success) {
    throw modelDecision.result;
  }

  const modelOutput = modelDecision.result;

  if (modelOutput.type === "final") {
    const requiresAction =
      /\b(reschedul|schedule|book|created|ticket|payment|refund|cancel)\b/i.test(
        modelOutput.text,
      );
    const replyText = requiresAction
      ? "I can help with that. Want me to proceed?"
      : modelOutput.text;
    await deps.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: new Date().toISOString(),
      speaker: "agent",
      text: replyText,
      meta: {
        intent: "final",
        tools,
        modelCalls,
        customerId: resolvedCustomer?.id ?? customer.id,
        contextUsed: Boolean(context),
        contextTurns,
      },
    });

    return {
      callSessionId,
      replyText,
      actions,
    };
  }

  const intent = modelOutput.toolName;
  const args = (modelOutput.arguments ?? {}) as Record<string, unknown>;
  let toolResult: ToolResult;
  let toolCustomer = customer;
  let ticketId: string | undefined;

  switch (modelOutput.toolName) {
    case "crm.lookupCustomerByPhone": {
      const phone = getStringArg(args, "phoneE164") ?? phoneE164;
      const call = await recordToolCall("crm.lookupCustomerByPhone", () =>
        deps.crm.lookupCustomerByPhone(phone),
      );
      tools.push(call.record);
      const result = Array.isArray(call.result) ? call.result : [];
      if (result.length === 1 && result[0]) {
        toolCustomer = result[0];
      }
      toolResult = {
        toolName: "crm.lookupCustomerByPhone",
        result,
      };
      break;
    }
    case "crm.lookupCustomerByNameAndZip": {
      const fullName = getStringArg(args, "fullName");
      const zipCode = getStringArg(args, "zipCode");
      if (!fullName || !zipCode) {
        toolResult = {
          toolName: "agent.message",
          result: {
            kind: "missing_arguments",
            details:
              "Full name and ZIP code are required to look up the account.",
          },
        };
        break;
      }
      const call = await recordToolCall("crm.lookupCustomerByNameAndZip", () =>
        deps.crm.lookupCustomerByNameAndZip(fullName, zipCode),
      );
      tools.push(call.record);
      const result = Array.isArray(call.result) ? call.result : [];
      if (result.length === 1 && result[0]) {
        toolCustomer = result[0];
      }
      toolResult = {
        toolName: "crm.lookupCustomerByNameAndZip",
        result,
      };
      break;
    }
    case "crm.lookupCustomerByEmail": {
      const email = getStringArg(args, "email");
      if (!email) {
        toolResult = {
          toolName: "agent.message",
          result: {
            kind: "missing_arguments",
            details: "An email address is required to look up the account.",
          },
        };
        break;
      }
      const call = await recordToolCall("crm.lookupCustomerByEmail", () =>
        deps.crm.lookupCustomerByEmail(email),
      );
      tools.push(call.record);
      const result = Array.isArray(call.result) ? call.result : [];
      if (result.length === 1 && result[0]) {
        toolCustomer = result[0];
      }
      toolResult = {
        toolName: "crm.lookupCustomerByEmail",
        result,
      };
      break;
    }
    case "crm.verifyAccount": {
      const customerId =
        getStringArg(args, "customerId") ?? resolvedCustomer?.id;
      const zipCode = getStringArg(args, "zipCode");
      if (!customerId || !zipCode) {
        toolResult = {
          toolName: "agent.message",
          result: {
            kind: "missing_arguments",
            details:
              "Customer ID and ZIP code are required to verify the account.",
          },
        };
        break;
      }
      const call = await recordToolCall("crm.verifyAccount", () =>
        deps.crm.verifyAccount(customerId, zipCode),
      );
      tools.push(call.record);
      const ok = Boolean(call.result);
      summary = {
        identityStatus: ok ? "verified" : "pending",
        verifiedCustomerId: ok ? customerId : null,
      };
      await deps.calls.updateSessionSummary({
        callSessionId,
        summary: buildSummary(summary),
      });
      toolResult = {
        toolName: "crm.verifyAccount",
        result: { ok },
      };
      break;
    }
    case "crm.getNextAppointment": {
      const customerId =
        getStringArg(args, "customerId") ?? resolvedCustomer?.id;
      if (!customerId) {
        toolResult = {
          toolName: "agent.message",
          result: {
            kind: "missing_arguments",
            details: "Customer ID is required to load appointments.",
          },
        };
        break;
      }
      const call = await recordToolCall("crm.getNextAppointment", () =>
        deps.crm.getNextAppointment(customerId),
      );
      tools.push(call.record);
      toolResult = {
        toolName: "crm.getNextAppointment",
        result: call.result ?? null,
      };
      break;
    }
    case "crm.listUpcomingAppointments": {
      const customerId =
        getStringArg(args, "customerId") ?? resolvedCustomer?.id;
      if (!customerId) {
        toolResult = {
          toolName: "agent.message",
          result: {
            kind: "missing_arguments",
            details: "Customer ID is required to list appointments.",
          },
        };
        break;
      }
      const limit = getNumberArg(args, "limit");
      const call = await recordToolCall("crm.listUpcomingAppointments", () =>
        deps.crm.listUpcomingAppointments(customerId, limit),
      );
      tools.push(call.record);
      toolResult = {
        toolName: "crm.listUpcomingAppointments",
        result: Array.isArray(call.result) ? call.result : [],
      };
      break;
    }
    case "crm.getAppointmentById": {
      const appointmentId = getStringArg(args, "appointmentId");
      if (!appointmentId) {
        toolResult = {
          toolName: "agent.message",
          result: {
            kind: "missing_arguments",
            details: "Appointment ID is required to load that appointment.",
          },
        };
        break;
      }
      const call = await recordToolCall("crm.getAppointmentById", () =>
        deps.crm.getAppointmentById(appointmentId),
      );
      tools.push(call.record);
      toolResult = {
        toolName: "crm.getAppointmentById",
        result: call.result ?? null,
      };
      break;
    }
    case "crm.getOpenInvoices": {
      const customerId =
        getStringArg(args, "customerId") ?? resolvedCustomer?.id;
      if (!customerId) {
        toolResult = {
          toolName: "agent.message",
          result: {
            kind: "missing_arguments",
            details: "Customer ID is required to look up invoices.",
          },
        };
        break;
      }
      const call = await recordToolCall("crm.getOpenInvoices", () =>
        deps.crm.getOpenInvoices(customerId),
      );
      tools.push(call.record);
      const invoices = Array.isArray(call.result) ? call.result : [];
      const balanceCents = invoices.reduce(
        (sum, invoice) => sum + (invoice.balanceCents ?? 0),
        0,
      );
      const balance =
        invoices.find((invoice) => invoice.balance)?.balance ??
        (balanceCents / 100).toFixed(2);
      const currency = invoices.find((invoice) => invoice.currency)?.currency;
      toolResult = {
        toolName: "crm.getOpenInvoices",
        result: {
          balanceCents,
          balance,
          currency,
          invoiceCount: invoices.length,
        },
      };
      break;
    }
    case "crm.getAvailableSlots": {
      const customerId =
        getStringArg(args, "customerId") ?? resolvedCustomer?.id;
      if (!customerId) {
        toolResult = {
          toolName: "agent.message",
          result: {
            kind: "missing_arguments",
            details: "Customer ID is required to look up available slots.",
          },
        };
        break;
      }
      const inputArgs = {
        daysAhead: getNumberArg(args, "daysAhead"),
        fromDate: getStringArg(args, "fromDate"),
        toDate: getStringArg(args, "toDate"),
        preference: getStringArg(args, "preference") as
          | "morning"
          | "afternoon"
          | "any"
          | undefined,
      };
      const call = await recordToolCall("crm.getAvailableSlots", () =>
        deps.crm.getAvailableSlots(customerId, inputArgs),
      );
      tools.push(call.record);
      const slots = Array.isArray(call.result) ? call.result : [];
      toolResult =
        slots.length > 0
          ? {
              toolName: "crm.getAvailableSlots",
              result: slots,
            }
          : {
              toolName: "agent.message",
              result: {
                kind: "no_slots",
                details: "No available time slots were found.",
              },
            };
      break;
    }
    case "crm.rescheduleAppointment": {
      const appointmentId = getStringArg(args, "appointmentId");
      const slotId = getStringArg(args, "slotId");
      if (!appointmentId || !slotId) {
        toolResult = {
          toolName: "agent.message",
          result: {
            kind: "missing_arguments",
            details: "Appointment ID and slot ID are required to reschedule.",
          },
        };
        break;
      }
      const call = await recordToolCall("crm.rescheduleAppointment", () =>
        deps.crm.rescheduleAppointment(appointmentId, slotId),
      );
      tools.push(call.record);
      if (call.result && (call.result as { ok?: boolean }).ok) {
        const updated = (
          call.result as { appointment?: { date: string; timeWindow: string } }
        ).appointment;
        if (updated) {
          toolResult = {
            toolName: "crm.rescheduleAppointment",
            result: {
              date: updated.date,
              timeWindow: updated.timeWindow,
            },
          };
          break;
        }
      }
      toolResult = {
        toolName: "agent.message",
        result: {
          kind: "reschedule_failed",
          details:
            "Unable to reschedule with the provided appointment and slot.",
        },
      };
      break;
    }
    case "crm.createAppointment": {
      const customerId =
        getStringArg(args, "customerId") ?? resolvedCustomer?.id;
      const preferredWindow = getStringArg(args, "preferredWindow");
      if (!customerId || !preferredWindow) {
        toolResult = {
          toolName: "agent.message",
          result: {
            kind: "missing_arguments",
            details:
              "Customer ID and preferred window are required to create an appointment.",
          },
        };
        break;
      }
      const call = await recordToolCall("crm.createAppointment", () =>
        deps.crm.createAppointment({
          customerId,
          preferredWindow,
          notes: getStringArg(args, "notes"),
          pestType: getStringArg(args, "pestType"),
        }),
      );
      tools.push(call.record);
      toolResult = {
        toolName: "crm.createAppointment",
        result: {
          ok: Boolean((call.result as { ok?: boolean })?.ok),
          appointmentId: (call.result as { appointmentId?: string })
            ?.appointmentId,
        },
      };
      break;
    }
    case "crm.getServicePolicy": {
      const topic = getStringArg(args, "topic");
      if (!topic) {
        toolResult = {
          toolName: "agent.message",
          result: {
            kind: "missing_arguments",
            details: "A policy topic is required.",
          },
        };
        break;
      }
      const call = await recordToolCall("crm.getServicePolicy", () =>
        deps.crm.getServicePolicy(topic),
      );
      tools.push(call.record);
      toolResult = {
        toolName: "crm.getServicePolicy",
        result: { text: String(call.result ?? "") },
      };
      break;
    }
    case "crm.escalate":
    case "agent.escalate": {
      const reason =
        getStringArg(args, "reason") ?? "Customer requested escalation";
      const summary =
        getStringArg(args, "summary") ??
        getStringArg(args, "message") ??
        input.text;
      const ticket = await createTicketUseCase(deps.tickets, {
        subject: reason,
        description: summary,
        category: "general",
        source: "agent",
        phoneE164,
      });
      ticketId = ticket.id;
      actions.push("created_ticket");
      toolResult =
        modelOutput.toolName === "crm.escalate"
          ? {
              toolName: "crm.escalate",
              result: { ok: true, ticketId },
            }
          : {
              toolName: "agent.escalate",
              result: { escalated: true },
            };
      break;
    }
    default: {
      toolResult = {
        toolName: "agent.message",
        result: {
          kind: "fallback",
          details: agentConfig.scopeMessage,
        },
      };
      break;
    }
  }

  summary = {
    identityStatus: summary.identityStatus,
    verifiedCustomerId: summary.verifiedCustomerId ?? null,
    lastToolName: toolResult.toolName,
    lastToolResult: stringifyToolResult(toolResult),
  };
  await deps.calls.updateSessionSummary({
    callSessionId,
    summary: buildSummary(summary),
  });

  const replyText = await generateReply(
    model,
    input,
    toolCustomer,
    toolResult,
    agentConfig.scopeMessage,
    context,
    modelCalls,
    messageHistory,
  );

  await deps.calls.addTurn({
    id: crypto.randomUUID(),
    callSessionId,
    ts: new Date().toISOString(),
    speaker: "agent",
    text: replyText,
    meta: {
      intent,
      tools,
      modelCalls,
      ticketId,
      customerId: resolvedCustomer?.id ?? customer.id,
      contextUsed: Boolean(context),
      contextTurns,
    },
  });

  return {
    callSessionId,
    replyText,
    actions,
    ticketId,
  };
};

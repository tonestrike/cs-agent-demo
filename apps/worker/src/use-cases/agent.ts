import { type ServiceAppointment, normalizePhoneE164 } from "@pestcall/core";
import type { Dependencies } from "../context";
import type { ModelAdapter, ToolResult } from "../models/types";
import type { AgentMessageInput, AgentMessageOutput } from "../schemas/agent";
import { getNextAppointment, rescheduleAppointment } from "./appointments";
import { createTicketUseCase } from "./tickets";

const zipRegex = /\b\d{5}\b/;

const extractZip = (text: string) => text.match(zipRegex)?.[0] ?? null;

const extractLastName = (displayName: string) => {
  const parts = displayName.trim().split(/\s+/);
  return parts.at(-1) ?? "";
};

const resolveCustomerMatch = (
  matches: Array<{
    id: string;
    displayName: string;
    phoneE164: string;
    addressSummary: string;
    zipCode?: string;
  }>,
  text: string,
) => {
  const zip = extractZip(text);
  const lowered = text.toLowerCase();
  const candidates = matches.filter((match) => {
    const lastName = extractLastName(match.displayName).toLowerCase();
    const hasLastName = lastName.length > 0 && lowered.includes(lastName);
    const hasZip = match.zipCode ? zip === match.zipCode : false;
    if (zip && match.zipCode) {
      return hasLastName && hasZip;
    }
    return hasLastName;
  });

  if (candidates.length === 1) {
    return candidates[0];
  }

  if (zip) {
    const zipMatches = matches.filter((match) => match.zipCode === zip);
    if (zipMatches.length === 1) {
      return zipMatches[0];
    }
  }

  return null;
};

const hasRescheduleRequest = (text: string) => {
  const lowered = text.toLowerCase();
  return lowered.includes("reschedule") || lowered.includes("change");
};

const hasPaymentRequest = (text: string) => {
  const lowered = text.toLowerCase();
  return lowered.includes("pay") || lowered.includes("payment");
};

const agentMessageKinds = {
  requestCustomerInfo: "request_customer_info",
  requestZip: "request_zip",
  noAppointment: "no_appointment",
  noSlots: "no_slots",
  rescheduleConfirmed: "reschedule_confirmed",
  ticketCreated: "ticket_created",
} as const;

const agentIntents = {
  rescheduleOffer: "reschedule_offer",
} as const;

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
) => {
  const responseCall = await recordModelCall(model, "respond", () =>
    model.respond({
      text: input.text,
      customer: buildCustomerContext(customer),
      context,
      hasContext: Boolean(context),
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
  let recentContext = "";
  let contextTurns = 0;
  let lastSuggestedSlot: {
    id?: string;
    date: string;
    timeWindow: string;
  } | null = null;
  if (!callSessionId) {
    callSessionId = crypto.randomUUID();
    await deps.calls.createSession({
      id: callSessionId,
      startedAt: nowIso,
      phoneE164,
      status: "active",
      transport: "web",
    });
  } else {
    const recentTurns = await deps.calls.getTurns(callSessionId);
    recentContext = recentTurns
      .map((turn) => `${turn.speaker}: ${turn.text}`)
      .join("\n");
    contextTurns = recentTurns.length;
    for (const turn of [...recentTurns].reverse()) {
      if (turn.speaker === "agent") {
        const meta = turn.meta as {
          suggestedSlot?: { id?: string; date: string; timeWindow: string };
        };
        if (!lastSuggestedSlot && meta.suggestedSlot) {
          lastSuggestedSlot = meta.suggestedSlot;
        }
        break;
      }
    }
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

  if (matches.length === 0) {
    const ticket = await createTicketUseCase(deps.tickets, {
      subject: "Unknown caller",
      description: `No CRM match for ${phoneE164}. Caller said: ${input.text}`,
      category: "unknown",
      source: "agent",
      phoneE164,
    });

    actions.push("created_ticket");

    const replyText = await generateReply(
      model,
      input,
      {
        id: "unknown",
        displayName: "Unknown caller",
        phoneE164,
        addressSummary: "Unknown",
      },
      {
        toolName: "agent.message",
        result: {
          kind: agentMessageKinds.requestCustomerInfo,
          details: `No CRM match for ${phoneE164}. Ticket ${ticket.id} created.`,
        },
      },
      agentConfig.scopeMessage,
      recentContext,
      modelCalls,
    );

    await deps.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: new Date().toISOString(),
      speaker: "agent",
      text: replyText,
      meta: {
        intent: "lookup",
        tools,
        modelCalls,
        ticketId: ticket.id,
        contextUsed: Boolean(recentContext),
        contextTurns,
      },
    });

    return {
      callSessionId,
      replyText,
      actions,
      ticketId: ticket.id,
    };
  }

  const resolvedCustomer =
    matches.length > 1 ? resolveCustomerMatch(matches, input.text) : null;

  if (matches.length > 1 && !resolvedCustomer) {
    const replyText =
      "I found multiple accounts. Please confirm your last name and ZIP code.";

    await deps.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: new Date().toISOString(),
      speaker: "agent",
      text: replyText,
      meta: {
        intent: "lookup",
        tools,
        modelCalls,
        contextUsed: Boolean(recentContext),
        contextTurns,
      },
    });

    return {
      callSessionId,
      replyText,
      actions,
    };
  }

  const customer = resolvedCustomer ?? matches[0];
  if (!customer) {
    const replyText =
      "I could not identify your account. Can you confirm your phone number?";

    await deps.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: new Date().toISOString(),
      speaker: "agent",
      text: replyText,
      meta: {
        intent: "lookup",
        tools,
        modelCalls,
        contextUsed: Boolean(recentContext),
        contextTurns,
      },
    });

    return {
      callSessionId,
      replyText,
      actions,
    };
  }

  if (!input.text.trim()) {
    const replyText = agentConfig.greeting;
    await deps.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: new Date().toISOString(),
      speaker: "agent",
      text: replyText,
      meta: {
        intent: "greeting",
        tools,
        modelCalls,
        customerId: customer.id,
        contextUsed: Boolean(recentContext),
        contextTurns,
      },
    });

    return {
      callSessionId,
      replyText,
      actions,
    };
  }

  const modelDecision = await recordModelCall(model, "decide", () =>
    model.generate({
      text: input.text,
      customer: buildCustomerContext(customer),
      context: recentContext,
      hasContext: Boolean(recentContext),
    }),
  );
  modelCalls.push(modelDecision.record);

  if (!modelDecision.record.success) {
    throw modelDecision.result;
  }

  const modelOutput = modelDecision.result;

  if (modelOutput.type === "final") {
    const replyText = modelOutput.text;
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
        customerId: customer.id,
        contextUsed: Boolean(recentContext),
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

  if (modelOutput.toolName === "crm.getNextAppointment") {
    const appointmentCall = await recordToolCall(
      "appointments.getNextAppointment",
      () => getNextAppointment(deps.appointments, customer.id),
    );
    tools.push(appointmentCall.record);

    const appointment = appointmentCall.result as ServiceAppointment | null;

    if (!appointment) {
      const ticket = await createTicketUseCase(deps.tickets, {
        subject: "Appointment not found",
        description: `No appointment found for ${customer.displayName}.`,
        category: "appointment",
        source: "agent",
        phoneE164,
      });

      actions.push("created_ticket");

      const replyText = await generateReply(
        model,
        input,
        customer,
        {
          toolName: "agent.message",
          result: {
            kind: agentMessageKinds.noAppointment,
            details: `No appointment found for ${customer.displayName}. Ticket ${ticket.id} created.`,
          },
        },
        agentConfig.scopeMessage,
        recentContext,
        modelCalls,
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
          ticketId: ticket.id,
          customerId: customer.id,
        },
      });

      return {
        callSessionId,
        replyText,
        actions,
        ticketId: ticket.id,
      };
    }

    if (hasRescheduleRequest(input.text)) {
      const slotsCall = await recordToolCall("crm.getAvailableSlots", () =>
        deps.crm.getAvailableSlots(customer.id, {
          fromDate: appointment.date,
          toDate: appointment.date,
        }),
      );
      tools.push(slotsCall.record);

      const slots = Array.isArray(slotsCall.result) ? slotsCall.result : [];
      const slot = slots[0];
      if (slot) {
        const replyText = await generateReply(
          model,
          input,
          customer,
          {
            toolName: "crm.getAvailableSlots",
            result: slot,
          },
          agentConfig.scopeMessage,
          recentContext,
          modelCalls,
        );

        await deps.calls.addTurn({
          id: crypto.randomUUID(),
          callSessionId,
          ts: new Date().toISOString(),
          speaker: "agent",
          text: replyText,
          meta: {
            intent: agentIntents.rescheduleOffer,
            tools,
            modelCalls,
            customerId: customer.id,
            suggestedSlot: slot,
            contextUsed: Boolean(recentContext),
            contextTurns,
          },
        });

        return {
          callSessionId,
          replyText,
          actions,
        };
      }
    }

    const replyText = await generateReply(
      model,
      input,
      customer,
      {
        toolName: "crm.getNextAppointment",
        result: {
          date: appointment.date,
          timeWindow: appointment.timeWindow,
          addressSummary: appointment.addressSummary,
        },
      },
      agentConfig.scopeMessage,
      recentContext,
      modelCalls,
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
        customerId: customer.id,
        contextUsed: Boolean(recentContext),
        contextTurns,
      },
    });

    return {
      callSessionId,
      replyText,
      actions,
    };
  }

  if (modelOutput.toolName === "crm.rescheduleAppointment") {
    const appointmentCall = await recordToolCall(
      "appointments.getNextAppointment",
      () => getNextAppointment(deps.appointments, customer.id),
    );
    tools.push(appointmentCall.record);

    const appointment = appointmentCall.result as ServiceAppointment | null;
    if (!appointment) {
      const replyText = await generateReply(
        model,
        input,
        customer,
        {
          toolName: "agent.message",
          result: {
            kind: agentMessageKinds.noAppointment,
            details: "No scheduled appointment was found for this customer.",
          },
        },
        agentConfig.scopeMessage,
        recentContext,
        modelCalls,
      );

      await deps.calls.addTurn({
        id: crypto.randomUUID(),
        callSessionId,
        ts: new Date().toISOString(),
        speaker: "agent",
        text: replyText,
        meta: {
          intent: "crm.rescheduleAppointment",
          tools,
          modelCalls,
          customerId: customer.id,
          contextUsed: Boolean(recentContext),
          contextTurns,
        },
      });

      return {
        callSessionId,
        replyText,
        actions,
      };
    }

    let slot = lastSuggestedSlot;
    if (!slot) {
      const slotsCall = await recordToolCall("crm.getAvailableSlots", () =>
        deps.crm.getAvailableSlots(customer.id, {
          fromDate: appointment.date,
          toDate: appointment.date,
        }),
      );
      tools.push(slotsCall.record);

      const slots = Array.isArray(slotsCall.result) ? slotsCall.result : [];
      slot = slots[0]
        ? {
            id: slots[0].id,
            date: slots[0].date,
            timeWindow: slots[0].timeWindow,
          }
        : null;
    }

    if (!slot) {
      const replyText = await generateReply(
        model,
        input,
        customer,
        {
          toolName: "agent.message",
          result: {
            kind: agentMessageKinds.noSlots,
            details: "No alternate time slots are available for rescheduling.",
          },
        },
        agentConfig.scopeMessage,
        recentContext,
        modelCalls,
      );

      await deps.calls.addTurn({
        id: crypto.randomUUID(),
        callSessionId,
        ts: new Date().toISOString(),
        speaker: "agent",
        text: replyText,
        meta: {
          intent: "crm.rescheduleAppointment",
          tools,
          modelCalls,
          customerId: customer.id,
          contextUsed: Boolean(recentContext),
          contextTurns,
        },
      });

      return {
        callSessionId,
        replyText,
        actions,
      };
    }

    const rescheduled = await recordToolCall("appointments.reschedule", () =>
      rescheduleAppointment(deps.appointments, {
        appointment,
        slot: {
          date: slot.date,
          timeWindow: slot.timeWindow,
        },
      }),
    );
    tools.push(rescheduled.record);

    const replyText = await generateReply(
      model,
      input,
      customer,
      {
        toolName: "crm.rescheduleAppointment",
        result: {
          date: (rescheduled.result as { date: string }).date,
          timeWindow: (rescheduled.result as { timeWindow: string }).timeWindow,
        },
      },
      agentConfig.scopeMessage,
      recentContext,
      modelCalls,
    );

    await deps.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: new Date().toISOString(),
      speaker: "agent",
      text: replyText,
      meta: {
        intent: "crm.rescheduleAppointment",
        tools,
        modelCalls,
        customerId: customer.id,
        contextUsed: Boolean(recentContext),
        contextTurns,
      },
    });

    return {
      callSessionId,
      replyText,
      actions,
    };
  }

  if (modelOutput.toolName === "crm.getOpenInvoices") {
    const hasZip = zipRegex.test(input.text);
    if (!hasZip) {
      const replyText = await generateReply(
        model,
        input,
        customer,
        {
          toolName: "agent.message",
          result: {
            kind: agentMessageKinds.requestZip,
            details: "Billing details require ZIP verification.",
          },
        },
        agentConfig.scopeMessage,
        recentContext,
        modelCalls,
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
          customerId: customer.id,
          contextUsed: Boolean(recentContext),
          contextTurns,
        },
      });

      return {
        callSessionId,
        replyText,
        actions,
      };
    }

    const invoicesCall = await recordToolCall("crm.getOpenInvoices", () =>
      deps.crm.getOpenInvoices(customer.id),
    );
    tools.push(invoicesCall.record);

    const invoices = Array.isArray(invoicesCall.result)
      ? invoicesCall.result
      : [];
    const balanceCents = invoices.reduce(
      (sum, invoice) => sum + (invoice.balanceCents ?? 0),
      0,
    );

    const replyText = await generateReply(
      model,
      input,
      customer,
      {
        toolName: "crm.getOpenInvoices",
        result: {
          balanceCents,
          invoiceCount: invoices.length,
        },
      },
      agentConfig.scopeMessage,
      recentContext,
      modelCalls,
    );

    let ticketId: string | undefined;
    if (hasPaymentRequest(input.text)) {
      const ticket = await createTicketUseCase(deps.tickets, {
        subject: "Payment requested",
        description: `Customer requested payment link. Balance: ${balanceCents}`,
        category: "billing",
        source: "agent",
        phoneE164,
      });
      ticketId = ticket.id;
      actions.push("created_ticket");
    }

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
        customerId: customer.id,
        contextUsed: Boolean(recentContext),
        contextTurns,
      },
    });

    return {
      callSessionId,
      replyText,
      actions,
      ticketId,
    };
  }

  if (modelOutput.toolName === "agent.escalate") {
    const ticket = await createTicketUseCase(deps.tickets, {
      subject: "Customer requested human",
      description: `Customer asked for a human. Message: ${input.text}`,
      category: "general",
      source: "agent",
      phoneE164,
    });
    actions.push("created_ticket");

    const replyText = await generateReply(
      model,
      input,
      customer,
      {
        toolName: "agent.escalate",
        result: { escalated: true },
      },
      agentConfig.scopeMessage,
      recentContext,
      modelCalls,
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
        ticketId: ticket.id,
        customerId: customer.id,
        contextUsed: Boolean(recentContext),
        contextTurns,
      },
    });

    return {
      callSessionId,
      replyText,
      actions,
      ticketId: ticket.id,
    };
  }

  const ticket = await createTicketUseCase(deps.tickets, {
    subject: "Needs follow-up",
    description: `Unhandled request: ${input.text}`,
    category: "general",
    source: "agent",
    phoneE164,
  });
  actions.push("created_ticket");

  const replyText = await generateReply(
    model,
    input,
    customer,
    {
      toolName: "agent.message",
      result: {
        kind: agentMessageKinds.ticketCreated,
        details: `Ticket ${ticket.id} created for follow-up.`,
      },
    },
    agentConfig.scopeMessage,
    recentContext,
    modelCalls,
  );

  await deps.calls.addTurn({
    id: crypto.randomUUID(),
    callSessionId,
    ts: new Date().toISOString(),
    speaker: "agent",
    text: replyText,
    meta: {
      intent: "fallback",
      tools,
      modelCalls,
      ticketId: ticket.id,
      customerId: customer.id,
      contextUsed: Boolean(recentContext),
      contextTurns,
    },
  });

  return {
    callSessionId,
    replyText,
    actions,
    ticketId: ticket.id,
  };
};

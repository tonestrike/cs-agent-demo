import { normalizePhoneE164 } from "@pestcall/core";

import type { Dependencies } from "../context";
import type { ToolResult } from "../models/types";
import type { AgentMessageInput, AgentMessageOutput } from "../schemas/agent";
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
  deps: Dependencies,
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
  const responseCall = await recordModelCall(deps.model, "respond", () =>
    deps.model.respond({
      text: input.text,
      customer: buildCustomerContext(customer),
      context,
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

  let callSessionId = input.callSessionId;
  let recentContext = "";
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
    const recentTurns = await deps.calls.getRecentTurns({
      callSessionId,
      limit: 6,
    });
    recentContext = recentTurns
      .map((turn) => `${turn.speaker}: ${turn.text}`)
      .join("\n");
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

    const replyText =
      "I could not find your account. Can you share your name and address?";

    await deps.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: new Date().toISOString(),
      speaker: "agent",
      text: replyText,
      meta: { intent: "lookup", tools, modelCalls, ticketId: ticket.id },
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
      meta: { intent: "lookup", tools, modelCalls },
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
      meta: { intent: "lookup", tools, modelCalls },
    });

    return {
      callSessionId,
      replyText,
      actions,
    };
  }

  const modelDecision = await recordModelCall(deps.model, "decide", () =>
    deps.model.generate({
      text: input.text,
      customer: buildCustomerContext(customer),
      context: recentContext,
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
      meta: { intent: "final", tools, modelCalls, customerId: customer.id },
    });

    return {
      callSessionId,
      replyText,
      actions,
    };
  }

  const intent = modelOutput.toolName;

  if (modelOutput.toolName === "crm.getNextAppointment") {
    const appointmentCall = await recordToolCall("crm.getNextAppointment", () =>
      deps.crm.getNextAppointment(customer.id),
    );
    tools.push(appointmentCall.record);

    const appointment = appointmentCall.result as {
      id: string;
      date: string;
      timeWindow: string;
      addressSummary: string;
    } | null;

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
        deps,
        input,
        customer,
        {
          toolName: "crm.getNextAppointment",
          result: null,
        },
        "I couldn't find a scheduled appointment. I've opened a ticket for our team.",
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
          from: appointment.date,
          to: appointment.date,
        }),
      );
      tools.push(slotsCall.record);

      const slots = Array.isArray(slotsCall.result) ? slotsCall.result : [];
      const slot = slots[0];
      if (slot) {
        const rescheduleCall = await recordToolCall(
          "crm.rescheduleAppointment",
          () => deps.crm.rescheduleAppointment(appointment.id, slot.id),
        );
        tools.push(rescheduleCall.record);

        const replyText = await generateReply(
          deps,
          input,
          customer,
          {
            toolName: "crm.rescheduleAppointment",
            result: {
              date: slot.date,
              timeWindow: slot.timeWindow,
            },
          },
          `I moved your appointment. Your new window is ${slot.date} ${slot.timeWindow}.`,
          recentContext,
          modelCalls,
        );

        await deps.calls.addTurn({
          id: crypto.randomUUID(),
          callSessionId,
          ts: new Date().toISOString(),
          speaker: "agent",
          text: replyText,
          meta: { intent, tools, modelCalls, customerId: customer.id },
        });

        return {
          callSessionId,
          replyText,
          actions,
        };
      }
    }

    const replyText = await generateReply(
      deps,
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
      `Your next appointment is ${appointment.date} ${appointment.timeWindow} at ${appointment.addressSummary}.`,
      recentContext,
      modelCalls,
    );

    await deps.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: new Date().toISOString(),
      speaker: "agent",
      text: replyText,
      meta: { intent, tools, modelCalls, customerId: customer.id },
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
      const replyText =
        "Before I can share billing details, please confirm your ZIP code.";

      await deps.calls.addTurn({
        id: crypto.randomUUID(),
        callSessionId,
        ts: new Date().toISOString(),
        speaker: "agent",
        text: replyText,
        meta: { intent, tools, modelCalls, customerId: customer.id },
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
      deps,
      input,
      customer,
      {
        toolName: "crm.getOpenInvoices",
        result: {
          balanceCents,
          invoiceCount: invoices.length,
        },
      },
      balanceCents === 0
        ? "You have no outstanding balance."
        : `Your current balance is $${(balanceCents / 100).toFixed(2)}.`,
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
      meta: { intent, tools, modelCalls, ticketId, customerId: customer.id },
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
      deps,
      input,
      customer,
      {
        toolName: "agent.escalate",
        result: { escalated: true },
      },
      "I have created a ticket for a specialist to follow up shortly.",
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

  const ticket = await createTicketUseCase(deps.tickets, {
    subject: "Needs follow-up",
    description: `Unhandled request: ${input.text}`,
    category: "general",
    source: "agent",
    phoneE164,
  });
  actions.push("created_ticket");

  const replyText = "I’ve opened a ticket for our team to follow up with you.";

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
    },
  });

  return {
    callSessionId,
    replyText,
    actions,
    ticketId: ticket.id,
  };
};

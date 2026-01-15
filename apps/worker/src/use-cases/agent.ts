import { normalizePhoneE164 } from "@pestcall/core";
import type { Dependencies } from "../context";

import { createTicketUseCase } from "./tickets";

export type AgentMessageInput = {
  callSessionId?: string;
  phoneNumber: string;
  text: string;
};

export type AgentMessageOutput = {
  callSessionId: string;
  replyText: string;
  actions: string[];
  ticketId?: string;
};

const zipRegex = /\b\d{5}\b/;

const detectIntent = (text: string) => {
  const lowered = text.toLowerCase();
  if (
    lowered.includes("agent") ||
    lowered.includes("human") ||
    lowered.includes("representative")
  ) {
    return "escalation" as const;
  }
  if (
    lowered.includes("appointment") ||
    lowered.includes("schedule") ||
    lowered.includes("reschedule")
  ) {
    return "appointment" as const;
  }
  if (
    lowered.includes("bill") ||
    lowered.includes("invoice") ||
    lowered.includes("balance") ||
    lowered.includes("owe")
  ) {
    return "billing" as const;
  }
  return "unknown" as const;
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

export const handleAgentMessage = async (
  deps: Dependencies,
  input: AgentMessageInput,
  nowIso = new Date().toISOString(),
): Promise<AgentMessageOutput> => {
  const phoneE164 = normalizePhoneE164(input.phoneNumber);
  const tools: ToolCall[] = [];

  let callSessionId = input.callSessionId;
  if (!callSessionId) {
    callSessionId = crypto.randomUUID();
    await deps.calls.createSession({
      id: callSessionId,
      startedAt: nowIso,
      phoneE164,
      status: "active",
      transport: "web",
    });
  }

  await deps.calls.addTurn({
    id: crypto.randomUUID(),
    callSessionId,
    ts: nowIso,
    speaker: "caller",
    text: input.text,
    meta: {},
  });

  const intent = detectIntent(input.text);

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
      meta: { intent, tools, ticketId: ticket.id },
    });

    return {
      callSessionId,
      replyText,
      actions,
      ticketId: ticket.id,
    };
  }

  if (matches.length > 1) {
    const replyText =
      "I found multiple accounts. Please confirm your last name and ZIP code.";

    await deps.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: new Date().toISOString(),
      speaker: "agent",
      text: replyText,
      meta: { intent, tools },
    });

    return {
      callSessionId,
      replyText,
      actions,
    };
  }

  const customer = matches[0];
  if (!customer) {
    const replyText =
      "I could not identify your account. Can you confirm your phone number?";

    await deps.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: new Date().toISOString(),
      speaker: "agent",
      text: replyText,
      meta: { intent, tools },
    });

    return {
      callSessionId,
      replyText,
      actions,
    };
  }

  if (intent === "appointment") {
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

      const replyText =
        "I couldn't find a scheduled appointment. I've opened a ticket for our team.";

      await deps.calls.addTurn({
        id: crypto.randomUUID(),
        callSessionId,
        ts: new Date().toISOString(),
        speaker: "agent",
        text: replyText,
        meta: { intent, tools, ticketId: ticket.id },
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

        const replyText = `I moved your appointment. Your new window is ${slot.date} ${slot.timeWindow}.`;

        await deps.calls.addTurn({
          id: crypto.randomUUID(),
          callSessionId,
          ts: new Date().toISOString(),
          speaker: "agent",
          text: replyText,
          meta: { intent, tools },
        });

        return {
          callSessionId,
          replyText,
          actions,
        };
      }
    }

    const replyText =
      `Your next appointment is ${appointment.date} ` +
      `${appointment.timeWindow} at ${appointment.addressSummary}.`;

    await deps.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: new Date().toISOString(),
      speaker: "agent",
      text: replyText,
      meta: { intent, tools },
    });

    return {
      callSessionId,
      replyText,
      actions,
    };
  }

  if (intent === "billing") {
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
        meta: { intent, tools },
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

    const replyText =
      balanceCents === 0
        ? "You have no outstanding balance."
        : `Your current balance is $${(balanceCents / 100).toFixed(2)}.`;

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
      meta: { intent, tools, ticketId },
    });

    return {
      callSessionId,
      replyText,
      actions,
      ticketId,
    };
  }

  if (intent === "escalation") {
    const ticket = await createTicketUseCase(deps.tickets, {
      subject: "Customer requested human",
      description: `Customer asked for a human. Message: ${input.text}`,
      category: "general",
      source: "agent",
      phoneE164,
    });
    actions.push("created_ticket");

    const replyText =
      "I have created a ticket for a specialist to follow up shortly.";

    await deps.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: new Date().toISOString(),
      speaker: "agent",
      text: replyText,
      meta: { intent, tools, ticketId: ticket.id },
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
    meta: { intent, tools, ticketId: ticket.id },
  });

  return {
    callSessionId,
    replyText,
    actions,
    ticketId: ticket.id,
  };
};

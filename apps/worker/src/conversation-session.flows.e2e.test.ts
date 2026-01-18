import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import { ServiceAppointmentStatus } from "@pestcall/core";

type RpcResponse<T> = { json: T; meta: unknown[] };

interface E2EEnv {
  E2E_BASE_URL?: string;
  E2E_AUTH_TOKEN?: string;
  DEMO_AUTH_TOKEN?: string;
  E2E_PHONE?: string;
  E2E_ZIP?: string;
}

const env = process.env as E2EEnv;
const baseUrl = env.E2E_BASE_URL ?? "http://127.0.0.1:8787";
const authToken = env.E2E_AUTH_TOKEN ?? env.DEMO_AUTH_TOKEN ?? "";
const isRemote = Boolean(env.E2E_BASE_URL);

const fixtures = {
  verify: {
    customerId: "cust_001",
    phone: env.E2E_PHONE ?? "+14155552671",
    zip: env.E2E_ZIP ?? "94107",
  },
  reschedule: {
    customerId: "cust_002",
    appointmentId: "appt_002",
    phone: "+14155550987",
    zip: "98109",
    slotId: "slot_001",
  },
  cancel: {
    customerId: "cust_003",
    appointmentId: "appt_003",
    phone: "+14155551234",
    zip: "60601",
  },
};

const postJson = async <T>(
  path: string,
  payload: Record<string, unknown>,
): Promise<T> => {
  const request = new Request(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authToken ? { "x-demo-auth": authToken } : {}),
    },
    body: JSON.stringify(payload),
  });
  const response = await fetch(request);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed ${response.status}: ${text}`);
  }
  return (await response.json()) as T;
};

const getJson = async <T>(path: string): Promise<T> => {
  const request = new Request(new URL(path, baseUrl), {
    method: "GET",
    headers: {
      ...(authToken ? { "x-demo-auth": authToken } : {}),
    },
  });
  const response = await fetch(request);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed ${response.status}: ${text}`);
  }
  return (await response.json()) as T;
};

const callRpc = async <T>(
  path: string,
  input?: Record<string, unknown>,
): Promise<T> => {
  const request = new Request(new URL(`/rpc/${path}`, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authToken ? { "x-demo-auth": authToken } : {}),
    },
    body: JSON.stringify({
      json: input ?? {},
      meta: [],
    }),
  });
  const response = await fetch(request);
  const data = (await response.json()) as RpcResponse<T>;
  if (!response.ok) {
    throw new Error(
      JSON.stringify({ path, status: response.status, body: data.json }),
    );
  }
  return data.json;
};

const sendMessage = async (
  conversationId: string,
  input: { text: string; phone?: string },
) => {
  return postJson<{
    response: string;
    streamed: boolean;
    messageId: string;
    turnId: number;
  }>(`/api/conversations/${conversationId}/message`, {
    phoneNumber: input.phone,
    callSessionId: conversationId,
    text: input.text,
  });
};

const waitForDebugState = async (
  conversationId: string,
  predicate: (state: Record<string, unknown>) => boolean,
  attempts = 60,
  delayMs = 1000,
) => {
  for (let i = 0; i < attempts; i += 1) {
    const debug = await getJson<{
      sessionState: { domainState: Record<string, unknown> };
    }>(`/api/conversations/${conversationId}/debug`);
    const state = debug.sessionState?.domainState ?? {};
    if (predicate(state)) {
      return state;
    }
    await delay(delayMs);
  }
  await debugSnapshot(conversationId);
  throw new Error("Timed out waiting for session state.");
};

const debugSnapshot = async (conversationId: string) => {
  try {
    const debug = await getJson<Record<string, unknown>>(
      `/api/conversations/${conversationId}/debug`,
    );
    console.log(
      `DEBUG for ${conversationId}:`,
      JSON.stringify(debug ?? {}, null, 2),
    );
  } catch (error) {
    console.log(`DEBUG fetch failed for ${conversationId}:`, String(error));
  }
};

const verifyConversation = async (
  conversationId: string,
  phone: string,
  zip: string,
  expectedCustomerId: string,
) => {
  await sendMessage(conversationId, { text: "hello", phone });
  await sendMessage(conversationId, {
    text: zip,
    phone,
  });

  const state = await waitForDebugState(
    conversationId,
    (domain) => {
      const conversation = domain["conversation"] as
        | { verification?: { verified?: boolean; customerId?: string } }
        | undefined;
      return (
        Boolean(conversation?.verification?.verified) &&
        conversation?.verification?.customerId === expectedCustomerId
      );
    },
    20,
    500,
  );

  return state;
};

const seedAppointmentCache = async (input: {
  customerId: string;
  phone: string;
  appointmentId: string;
  zip: string;
  address?: string;
}) => {
  try {
    const nowDate = new Date();
    const date = nowDate.toISOString().slice(0, 10);
    await callRpc("admin/createCustomer", {
      id: input.customerId,
      displayName: `E2E ${input.customerId}`,
      phoneE164: input.phone,
      zipCode: input.zip,
      addressSummary: input.address ?? "123 Test Street",
    });
    await callRpc("admin/createAppointment", {
      id: input.appointmentId,
      customerId: input.customerId,
      phoneE164: input.phone,
      addressSummary: input.address ?? "123 Test Street",
      date,
      timeWindow: "10:00-12:00",
      status: ServiceAppointmentStatus.Scheduled,
    });
  } catch (error) {
    if (isRemote) {
      console.log(
        "WARN: remote seed failed, continuing with existing data:",
        String(error),
      );
      return;
    }
    throw error;
  }
};

describe.concurrent("conversation flows e2e", () => {
  it("verifies a customer by ZIP and persists verification state", async () => {
    const conversationId = `verify-${crypto.randomUUID()}`;

    const state = await verifyConversation(
      conversationId,
      fixtures.verify.phone,
      fixtures.verify.zip,
      fixtures.verify.customerId,
    );

    const conversation = state["conversation"] as {
      verification?: { customerId?: string };
    } | null;
    expect(conversation?.verification?.customerId).toBe(
      fixtures.verify.customerId,
    );
  }, 30000);

  it("reschedules an appointment after verification", async () => {
    const conversationId = `resched-${crypto.randomUUID()}`;

    await seedAppointmentCache({
      customerId: fixtures.reschedule.customerId,
      appointmentId: fixtures.reschedule.appointmentId,
      phone: fixtures.reschedule.phone,
      zip: fixtures.reschedule.zip,
    });

    await verifyConversation(
      conversationId,
      fixtures.reschedule.phone,
      fixtures.reschedule.zip,
      fixtures.reschedule.customerId,
    );

    // Drive reschedule via workflow RPC for determinism
    const start = await callRpc<{ instanceId: string }>(
      "workflows/reschedule/start",
      {
        callSessionId: conversationId,
        customerId: fixtures.reschedule.customerId,
        intent: "reschedule",
        message: "Please reschedule my appointment.",
      },
    );

    await callRpc("workflows/reschedule/selectAppointment", {
      instanceId: start.instanceId,
      payload: { appointmentId: fixtures.reschedule.appointmentId },
    });

    await callRpc("workflows/reschedule/selectSlot", {
      instanceId: start.instanceId,
      payload: { slotId: fixtures.reschedule.slotId },
    });

    await callRpc("workflows/reschedule/confirm", {
      instanceId: start.instanceId,
      payload: { confirmed: true },
    });

    await assertAppointmentStatus(
      fixtures.reschedule.appointmentId,
      ServiceAppointmentStatus.Cancelled,
      "reschedule.original",
    );
  }, 120000);

  it("cancels an appointment after verification", async () => {
    const conversationId = `cancel-${crypto.randomUUID()}`;

    await seedAppointmentCache({
      customerId: fixtures.cancel.customerId,
      appointmentId: fixtures.cancel.appointmentId,
      phone: fixtures.cancel.phone,
      zip: fixtures.cancel.zip,
    });

    await verifyConversation(
      conversationId,
      fixtures.cancel.phone,
      fixtures.cancel.zip,
      fixtures.cancel.customerId,
    );

    const start = await callRpc<{ instanceId: string }>(
      "workflows/cancel/start",
      {
        callSessionId: conversationId,
        customerId: fixtures.cancel.customerId,
        intent: "cancel",
        message: "Please cancel my appointment.",
      },
    );

    await callRpc("workflows/cancel/selectAppointment", {
      instanceId: start.instanceId,
      payload: { appointmentId: fixtures.cancel.appointmentId },
    });

    await callRpc("workflows/cancel/confirm", {
      instanceId: start.instanceId,
      payload: { confirmed: true },
    });

    await assertAppointmentStatus(
      fixtures.cancel.appointmentId,
      ServiceAppointmentStatus.Cancelled,
      "cancel",
    );
  }, 90000);
});

const assertAppointmentStatus = async (
  appointmentId: string,
  status: ServiceAppointmentStatus,
  label: string,
) => {
  const maxAttempts = 25;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await callRpc<{
        appointment: {
          status: ServiceAppointmentStatus;
          rescheduledToId: string | null;
          rescheduledFromId: string | null;
        } | null;
      }>("admin/getAppointment", { id: appointmentId });
      if (response.appointment?.status === status) {
        // If reschedule, also assert linkage when present
        if (
          status === ServiceAppointmentStatus.Cancelled &&
          response.appointment.rescheduledToId
        ) {
          const nextId = response.appointment.rescheduledToId;
          const next = await callRpc<{
            appointment: {
              status: ServiceAppointmentStatus;
              rescheduledFromId: string | null;
            } | null;
          }>("admin/getAppointment", { id: nextId });
          expect(next.appointment?.rescheduledFromId).toBe(appointmentId);
        }
        return;
      }
    } catch (error) {
      console.log(`DEBUG appointment poll failed (${label}):`, String(error));
    }
    await delay(1000);
  }
  try {
    const latest = await callRpc<{
      appointment: {
        status: ServiceAppointmentStatus;
        rescheduledToId: string | null;
        rescheduledFromId: string | null;
      } | null;
    }>("admin/getAppointment", { id: appointmentId });
    console.log(
      `DEBUG appointment ${appointmentId} (${label}):`,
      JSON.stringify(latest, null, 2),
    );
  } catch (error) {
    console.log(`DEBUG appointment fetch failed (${label}):`, String(error));
  }
  throw new Error(
    `Timed out waiting for appointment status change (${label}).`,
  );
};

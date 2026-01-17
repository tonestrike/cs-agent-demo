import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { ServiceAppointmentStatus } from "@pestcall/core";
import { describe, expect, it } from "vitest";

type RpcResponse<T> = {
  json: T;
  meta: unknown[];
};

interface E2EEnv {
  E2E_BASE_URL?: string;
  E2E_AUTH_TOKEN?: string;
  DEMO_AUTH_TOKEN?: string;
  E2E_PHONE?: string;
  E2E_ZIP?: string;
  E2E_CUSTOMER_ID?: string;
  E2E_APPOINTMENT_ID?: string;
}

const env = process.env as E2EEnv;
const baseUrl = env.E2E_BASE_URL ?? "http://127.0.0.1:8787";
const authToken = env.E2E_AUTH_TOKEN ?? env.DEMO_AUTH_TOKEN;
const fixture = {
  customerId: "cust_001",
  appointmentId: "appt_001",
  phoneE164: "+14155552671",
  zipCode: "94107",
  addressSummary: "742 Evergreen Terrace",
  appointmentDate: "2025-02-10",
  appointmentTimeWindow: "10:00-12:00",
};
const phoneNumber = env.E2E_PHONE ?? fixture.phoneE164;
const zipCode = env.E2E_ZIP ?? fixture.zipCode;
const customerId = env.E2E_CUSTOMER_ID ?? fixture.customerId;
const appointmentId = env.E2E_APPOINTMENT_ID ?? fixture.appointmentId;

const describeIf = env.E2E_BASE_URL ? describe : describe.skip;

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
    throw new Error(JSON.stringify(data.json));
  }
  return data.json;
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

describeIf("conversation session cancel confirmation e2e", () => {
  it("confirms cancellation via conversation", async () => {
    const conversationId = `e2e-cancel-${crypto.randomUUID()}`;
    const seededCustomerId = (
      await callRpc<{ id: string }>("admin/createCustomer", {
        id: customerId,
        displayName: "E2E Cancel Customer",
        phoneE164: phoneNumber,
        addressSummary: fixture.addressSummary,
        zipCode,
      })
    ).id;
    const seededAppointmentId = (
      await callRpc<{ id: string }>("admin/createAppointment", {
        id: appointmentId,
        customerId: seededCustomerId,
        phoneE164: phoneNumber,
        addressSummary: fixture.addressSummary,
        date: fixture.appointmentDate,
        timeWindow: fixture.appointmentTimeWindow,
        status: ServiceAppointmentStatus.Scheduled,
      })
    ).id;
    const start = await postJson<{
      ok: boolean;
      callSessionId: string;
    }>(`/api/conversations/${conversationId}/message`, {
      phoneNumber,
      text: "hello",
    });
    expect(start.ok).toBe(true);

    await postJson(`/api/conversations/${conversationId}/message`, {
      callSessionId: start.callSessionId,
      phoneNumber,
      text: zipCode,
    });

    await postJson(`/api/conversations/${conversationId}/message`, {
      callSessionId: start.callSessionId,
      phoneNumber,
      text: "Cancel my appointment.",
    });

    await waitForAppointments(conversationId);

    await postJson(`/api/conversations/${conversationId}/message`, {
      callSessionId: start.callSessionId,
      phoneNumber,
      text: seededAppointmentId,
    });

    await waitForPendingCancellation(conversationId, seededAppointmentId);

    const confirm = await postJson<{
      ok: boolean;
      callSessionId: string;
    }>(`/api/conversations/${conversationId}/message`, {
      callSessionId: start.callSessionId,
      phoneNumber,
      text: "Yes, please cancel it.",
    });

    expect(confirm.ok).toBe(true);
    expect(confirm.callSessionId).toBe(start.callSessionId);
    const appointmentStatus = await waitForAppointmentStatus(
      seededAppointmentId,
      ServiceAppointmentStatus.Cancelled,
    );
    expect(appointmentStatus).toBe(ServiceAppointmentStatus.Cancelled);
  });
});

const waitForAppointmentStatus = async (
  appointmentIdValue: string,
  expectedStatus: ServiceAppointmentStatus,
) => {
  const maxAttempts = 10;
  const delayMs = 1000;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await callRpc<{
      appointment: { status: ServiceAppointmentStatus } | null;
    }>("admin/getAppointment", { id: appointmentIdValue });
    const status = response.appointment?.status;
    if (status === expectedStatus) {
      return status;
    }
    await delay(delayMs);
  }
  throw new Error("Timed out waiting for appointment status update.");
};

const waitForAppointments = async (conversationId: string) => {
  const maxAttempts = 10;
  const delayMs = 1000;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const resync = await postJson<{
      state: { appointments: Array<{ id: string }> };
    }>(`/api/conversations/${conversationId}/resync`, { lastEventId: 0 });
    if (resync.state.appointments.length > 0) {
      return resync.state.appointments;
    }
    await delay(delayMs);
  }
  throw new Error("Timed out waiting for appointment options.");
};

const waitForPendingCancellation = async (
  conversationId: string,
  appointmentIdValue: string,
) => {
  const maxAttempts = 10;
  const delayMs = 1000;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const resync = await postJson<{
      state: { pendingCancellationId: string | null };
    }>(`/api/conversations/${conversationId}/resync`, { lastEventId: 0 });
    if (resync.state.pendingCancellationId === appointmentIdValue) {
      return resync;
    }
    await delay(delayMs);
  }
  throw new Error("Timed out waiting for cancellation state.");
};

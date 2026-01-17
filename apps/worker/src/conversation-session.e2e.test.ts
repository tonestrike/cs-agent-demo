import "dotenv/config";
import { describe, expect, it } from "vitest";

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
  const data = (await response.json()) as { json: T };
  if (!response.ok) {
    throw new Error(JSON.stringify(data.json));
  }
  return data.json;
};

describeIf("conversation session e2e", () => {
  it("accepts messages and resyncs events", async () => {
    const conversationId = `e2e-${crypto.randomUUID()}`;
    const customer = await callRpc<{ id: string }>("admin/createCustomer", {
      id: customerId,
      displayName: "E2E Message Customer",
      phoneE164: phoneNumber,
      addressSummary: fixture.addressSummary,
      zipCode,
    });
    await callRpc<{ id: string }>("admin/createAppointment", {
      id: appointmentId,
      customerId: customer.id,
      phoneE164: phoneNumber,
      addressSummary: fixture.addressSummary,
      date: fixture.appointmentDate,
      timeWindow: fixture.appointmentTimeWindow,
    });
    const messageResponse = await postJson<{
      ok: boolean;
      callSessionId: string;
    }>(`/api/conversations/${conversationId}/message`, {
      phoneNumber,
      text: "hello",
    });

    expect(messageResponse.ok).toBe(true);
    expect(messageResponse.callSessionId).toBeTruthy();

    const verification = await postJson<{
      ok: boolean;
      callSessionId: string;
    }>(`/api/conversations/${conversationId}/message`, {
      callSessionId: messageResponse.callSessionId,
      phoneNumber,
      text: zipCode,
    });

    expect(verification.ok).toBe(true);
    expect(verification.callSessionId).toBe(messageResponse.callSessionId);

    const appointments = await postJson<{
      ok: boolean;
      callSessionId: string;
    }>(`/api/conversations/${conversationId}/message`, {
      callSessionId: messageResponse.callSessionId,
      phoneNumber,
      text: "What are my appointments?",
    });
    expect(appointments.ok).toBe(true);

    const resyncAfterAppointments = await postJson<{
      state: {
        status: string;
        appointments: Array<{ id: string; date: string }>;
      };
    }>(`/api/conversations/${conversationId}/resync`, { lastEventId: 0 });

    expect(resyncAfterAppointments.state.status).toBe("PresentingAppointments");
    expect(
      resyncAfterAppointments.state.appointments.some(
        (appointment) =>
          appointment.id === appointmentId &&
          appointment.date === fixture.appointmentDate,
      ),
    ).toBe(true);

    const resync = await postJson<{
      events: Array<{ type: string }>;
      speaking: boolean;
      latestEventId: number;
    }>(`/api/conversations/${conversationId}/resync`, { lastEventId: 0 });

    expect(resync.events.length).toBeGreaterThan(0);
    expect(resync.events.some((event) => event.type === "final")).toBe(true);
    expect(resync.latestEventId).toBeGreaterThan(0);
  });
});

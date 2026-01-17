import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
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
const generatePhone = () => {
  const suffix = Math.floor(Math.random() * 10_000_000)
    .toString()
    .padStart(7, "0");
  return `+1415${suffix}`;
};
const phoneNumber = env.E2E_PHONE ?? generatePhone();
const zipCode = env.E2E_ZIP ?? "00000";
const customerId = env.E2E_CUSTOMER_ID;
const appointmentId = env.E2E_APPOINTMENT_ID;

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
    const seededCustomerId =
      customerId ??
      (
        await callRpc<{ id: string }>("admin/createCustomer", {
          displayName: "E2E Cancel Customer",
          phoneE164: phoneNumber,
          addressSummary: "100 Test Street",
          zipCode,
        })
      ).id;
    const _seededAppointmentId =
      appointmentId ??
      (
        await callRpc<{ id: string }>("admin/createAppointment", {
          customerId: seededCustomerId,
          phoneE164: phoneNumber,
          addressSummary: "100 Test Street",
          date: "2026-01-15",
          timeWindow: "10:00-12:00",
        })
      ).id;
    const start = await postJson<{
      callSessionId: string;
      replyText: string;
    }>(`/api/conversations/${conversationId}/message`, {
      phoneNumber,
      text: "hello",
    });

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

    await delay(1500);

    const confirm = await postJson<{
      callSessionId: string;
      replyText: string;
    }>(`/api/conversations/${conversationId}/message`, {
      callSessionId: start.callSessionId,
      phoneNumber,
      text: "Yes, please cancel it.",
    });

    expect(confirm.callSessionId).toBe(start.callSessionId);
    expect(confirm.replyText.length).toBeGreaterThan(0);
  });
});

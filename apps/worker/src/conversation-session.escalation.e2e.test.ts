import "dotenv/config";
import { describe, expect, it } from "vitest";

interface E2EEnv {
  E2E_BASE_URL?: string;
  E2E_AUTH_TOKEN?: string;
  DEMO_AUTH_TOKEN?: string;
  E2E_PHONE?: string;
  E2E_ZIP?: string;
  E2E_CUSTOMER_ID?: string;
}

const env = process.env as E2EEnv;
const baseUrl = env.E2E_BASE_URL ?? "http://127.0.0.1:8787";
const authToken = env.E2E_AUTH_TOKEN ?? env.DEMO_AUTH_TOKEN;
const fixture = {
  customerId: "cust_001",
  phoneE164: "+14155552671",
  zipCode: "94107",
  addressSummary: "742 Evergreen Terrace",
};
const phoneNumber = env.E2E_PHONE ?? fixture.phoneE164;
const zipCode = env.E2E_ZIP ?? fixture.zipCode;
const customerId = env.E2E_CUSTOMER_ID ?? fixture.customerId;

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

describeIf("conversation session escalation e2e", () => {
  it("escalates to a specialist via conversation", async () => {
    const conversationId = `e2e-${crypto.randomUUID()}`;
    await callRpc<{ id: string }>("admin/createCustomer", {
      id: customerId,
      displayName: "E2E Escalation Customer",
      phoneE164: phoneNumber,
      addressSummary: fixture.addressSummary,
      zipCode,
    });

    const messageResponse = await postJson<{
      callSessionId: string;
      replyText: string;
    }>(`/api/conversations/${conversationId}/message`, {
      phoneNumber,
      text: "hello",
    });

    await postJson<{
      callSessionId: string;
      replyText: string;
    }>(`/api/conversations/${conversationId}/message`, {
      callSessionId: messageResponse.callSessionId,
      phoneNumber,
      text: zipCode,
    });

    const escalation = await postJson<{
      callSessionId: string;
      replyText: string;
    }>(`/api/conversations/${conversationId}/message`, {
      callSessionId: messageResponse.callSessionId,
      phoneNumber,
      text: "I need to speak with a human.",
    });

    expect(escalation.replyText.toLowerCase()).toContain("ticket");
  });
});

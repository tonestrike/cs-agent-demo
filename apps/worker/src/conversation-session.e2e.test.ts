import "dotenv/config";
import { describe, expect, it } from "vitest";

interface E2EEnv {
  E2E_BASE_URL?: string;
  E2E_AUTH_TOKEN?: string;
  DEMO_AUTH_TOKEN?: string;
  E2E_PHONE?: string;
  E2E_ZIP?: string;
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
    await callRpc<{ id: string }>("admin/createCustomer", {
      displayName: "E2E Message Customer",
      phoneE164: phoneNumber,
      addressSummary: "100 Test Street",
      zipCode,
    });
    const messageResponse = await postJson<{
      callSessionId: string;
      replyText: string;
    }>(`/api/conversations/${conversationId}/message`, {
      phoneNumber,
      text: "hello",
    });

    expect(messageResponse.callSessionId).toBeTruthy();
    expect(messageResponse.replyText.length).toBeGreaterThan(0);

    await postJson(`/api/conversations/${conversationId}/message`, {
      callSessionId: messageResponse.callSessionId,
      phoneNumber,
      text: zipCode,
    });

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

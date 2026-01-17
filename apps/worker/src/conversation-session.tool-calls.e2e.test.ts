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
};
const phoneNumber = env.E2E_PHONE ?? fixture.phoneE164;
const zipCode = env.E2E_ZIP ?? fixture.zipCode;

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

describeIf("tool calling avoids empty finals", () => {
  it("reschedule intent after verification returns a meaningful agent turn (no interpret fallback)", async () => {
    const conversationId = `tool-e2e-${crypto.randomUUID()}`;

    // Turn 1: greet
    await postJson(`/api/conversations/${conversationId}/message`, {
      phoneNumber,
      text: "hello",
    });

    // Turn 2: provide ZIP to verify
    await postJson(`/api/conversations/${conversationId}/message`, {
      callSessionId: conversationId,
      phoneNumber,
      text: zipCode,
    });

    // Turn 3: reschedule request
    await postJson(`/api/conversations/${conversationId}/message`, {
      callSessionId: conversationId,
      phoneNumber,
      text: "I want to reschedule my appointment",
    });

    const debug = await postJson<{
      dbTurns: Array<{ speaker: string; text: string; meta_json?: string }>;
    }>(`/api/conversations/${conversationId}/debug`, {});

    const agentTurns = (debug.dbTurns ?? []).filter(
      (turn) => turn.speaker === "agent",
    );
    expect(agentTurns.length).toBeGreaterThan(0);
    const lastAgent = agentTurns[agentTurns.length - 1];
    expect(lastAgent).toBeTruthy();
    if (!lastAgent) return;
    expect(lastAgent.text.toLowerCase()).not.toContain("could not interpret");
    // Ensure a decision was recorded
    if (lastAgent.meta_json) {
      const meta = JSON.parse(lastAgent.meta_json) as {
        decision?: { decisionType?: string };
      };
      expect(meta.decision).toBeTruthy();
    }
  }, 60000);
});

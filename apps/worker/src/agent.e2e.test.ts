import "dotenv/config";
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
  E2E_MULTI_PHONE?: string;
  E2E_EXPECT_REAL_MODEL?: string;
  E2E_EXPECT_MODEL_NAME?: string;
  E2E_EXPECT_MODEL_ID?: string;
}

const env = process.env as E2EEnv;
const baseUrl = env.E2E_BASE_URL ?? "http://127.0.0.1:8787";
const authToken = env.E2E_AUTH_TOKEN ?? env.DEMO_AUTH_TOKEN;
const phoneNumber = env.E2E_PHONE ?? "+14155552671";
const multiMatchPhone = env.E2E_MULTI_PHONE ?? "+14155551234";
const expectRealModel = env.E2E_EXPECT_REAL_MODEL === "true";
const expectedModelName = env.E2E_EXPECT_MODEL_NAME;
const expectedModelId = env.E2E_EXPECT_MODEL_ID;

const describeIf = baseUrl ? describe : describe.skip;

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

const getLatestAgentTurnMeta = async (callSessionId: string) => {
  const detail = await callRpc<{
    turns: Array<{
      speaker: string;
      meta: Record<string, unknown>;
    }>;
  }>("calls/get", { callSessionId });

  const agentTurn = [...detail.turns]
    .reverse()
    .find((turn) => turn.speaker === "agent");
  return (agentTurn?.meta ?? {}) as {
    tools?: Array<{ toolName: string }>;
    modelCalls?: Array<{
      modelName: string;
      modelId?: string;
      kind: string;
      latencyMs: number;
      success: boolean;
    }>;
    customerId?: string;
    contextUsed?: boolean;
  };
};

const assertRealModelCalls = (
  modelCalls: Array<{
    modelName: string;
    modelId?: string;
    kind: string;
    latencyMs: number;
    success: boolean;
  }>,
) => {
  if (!expectRealModel) {
    return;
  }

  const nonMockCalls = modelCalls.filter((call) => call.modelName !== "mock");
  expect(nonMockCalls.length).toBeGreaterThan(0);
  for (const call of nonMockCalls) {
    if (expectedModelName) {
      expect(call.modelName).toBe(expectedModelName);
    }
    if (expectedModelId) {
      expect(call.modelId).toBe(expectedModelId);
    } else if (call.modelId) {
      expect(call.modelId).not.toBe("mock");
    }
  }
};

describeIf("agent e2e tool calls", () => {
  it("records appointment tool calls with expected data", async () => {
    const response = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      phoneNumber,
      text: "Please check my next appointment.",
    });

    expect(response.replyText.length).toBeGreaterThan(0);

    const meta = await getLatestAgentTurnMeta(response.callSessionId);
    const tools = meta.tools ?? [];
    const toolNames = tools.map((tool) => tool.toolName);
    expect(toolNames).toContain("crm.lookupCustomerByPhone");
    expect(response.replyText.toLowerCase()).toContain("zip");

    await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: response.callSessionId,
      phoneNumber,
      text: "94107",
    });

    const followUp = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: response.callSessionId,
      phoneNumber,
      text: "When is my next appointment?",
    });
    const followUpMeta = await getLatestAgentTurnMeta(followUp.callSessionId);
    const followUpTools = followUpMeta.tools ?? [];
    const followUpToolNames = followUpTools.map((tool) => tool.toolName);
    expect(followUpToolNames).toContain("crm.getNextAppointment");

    const modelCalls = meta.modelCalls ?? [];
    expect(modelCalls.length).toBeGreaterThan(0);
    expect(modelCalls[0]?.modelName).toBeTypeOf("string");
    if (modelCalls[0]?.modelId) {
      expect(modelCalls[0]?.modelId).toBeTypeOf("string");
    }
    assertRealModelCalls(modelCalls);
  });

  it("requires ZIP verification before billing details", async () => {
    const first = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      phoneNumber,
      text: "Do I owe anything?",
    });

    expect(first.replyText.toLowerCase()).toContain("zip");

    await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: first.callSessionId,
      phoneNumber,
      text: "My ZIP is 94107.",
    });

    const second = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: first.callSessionId,
      phoneNumber,
      text: "Do I owe anything?",
    });

    const meta = await getLatestAgentTurnMeta(second.callSessionId);
    const tools = meta.tools ?? [];
    const toolNames = tools.map((tool) => tool.toolName);
    expect(toolNames).toContain("crm.lookupCustomerByPhone");
    expect(toolNames).toContain("crm.getOpenInvoices");
    expect(meta.customerId).toBe("cust_001");

    const modelCalls = meta.modelCalls ?? [];
    expect(modelCalls.length).toBeGreaterThan(0);
    expect(modelCalls[0]?.modelName).toBeTypeOf("string");
    if (modelCalls[0]?.modelId) {
      expect(modelCalls[0]?.modelId).toBeTypeOf("string");
    }
    assertRealModelCalls(modelCalls);
  });

  it("maintains context for follow-up reschedule requests", async () => {
    const first = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      phoneNumber,
      text: "When is my next appointment?",
    });

    expect(first.replyText.length).toBeGreaterThan(0);

    await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: first.callSessionId,
      phoneNumber,
      text: "94107",
    });

    const second = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: first.callSessionId,
      phoneNumber,
      text: "Please reschedule to the next available slot.",
    });

    expect(second.replyText.length).toBeGreaterThan(0);
    expect(second.replyText.toLowerCase()).not.toContain("thanks for calling");

    const meta = await getLatestAgentTurnMeta(second.callSessionId);
    expect(meta.contextUsed).toBe(true);
    assertRealModelCalls(meta.modelCalls ?? []);

    const third = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: second.callSessionId,
      phoneNumber,
      text: "Any available slots next week?",
    });

    expect(third.replyText.length).toBeGreaterThan(0);

    const fourth = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: third.callSessionId,
      phoneNumber,
      text: "Please show available slots.",
    });

    const fourthMeta = await getLatestAgentTurnMeta(fourth.callSessionId);
    const fourthToolNames = (fourthMeta.tools ?? []).map(
      (tool) => tool.toolName,
    );
    expect(fourthToolNames).toContain("crm.getAvailableSlots");
  });

  it("avoids tool calls for off-topic requests", async () => {
    const response = await callRpc<{
      callSessionId: string;
      replyText: string;
      ticketId?: string;
    }>("agent/message", {
      phoneNumber,
      text: "What is the weather like tomorrow?",
    });

    expect(response.replyText.length).toBeGreaterThan(0);

    const meta = await getLatestAgentTurnMeta(response.callSessionId);
    const toolNames = (meta.tools ?? []).map((tool) => tool.toolName);
    if (toolNames.includes("agent.escalate")) {
      expect(response.ticketId).toBeTruthy();
    }
    const disallowed = [
      "crm.getNextAppointment",
      "crm.getOpenInvoices",
      "crm.getAvailableSlots",
      "crm.rescheduleAppointment",
    ];
    for (const toolName of disallowed) {
      expect(toolNames).not.toContain(toolName);
    }
    assertRealModelCalls(meta.modelCalls ?? []);
  });

  it("persists verified identity in the session summary", async () => {
    const first = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      phoneNumber,
      text: "Do I owe anything?",
    });

    await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: first.callSessionId,
      phoneNumber,
      text: "ZIP 94107.",
    });

    const detail = await callRpc<{
      session: { summary: string | null };
    }>("calls/get", { callSessionId: first.callSessionId });
    expect(detail.session?.summary).toBeTypeOf("string");
    const parsed = detail.session?.summary
      ? (JSON.parse(detail.session.summary) as { identityStatus?: string })
      : null;
    expect(parsed?.identityStatus).toBe("verified");
  });

  it("disambiguates multiple customers before disclosing details", async () => {
    const first = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      phoneNumber: multiMatchPhone,
      text: "When is my next appointment?",
    });

    expect(first.replyText.toLowerCase()).toContain("zip");

    const second = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: first.callSessionId,
      phoneNumber: multiMatchPhone,
      text: "Last name Quinn, ZIP 60601.",
    });

    expect(second.replyText.length).toBeGreaterThan(0);

    const meta = await getLatestAgentTurnMeta(second.callSessionId);
    const tools = meta.tools ?? [];
    const toolNames = tools.map((tool) => tool.toolName);
    expect(toolNames).toContain("crm.lookupCustomerByPhone");
    expect(toolNames).toContain("crm.lookupCustomerByNameAndZip");

    const modelCalls = meta.modelCalls ?? [];
    expect(modelCalls.length).toBeGreaterThan(0);
    assertRealModelCalls(modelCalls);
  });

  it("exposes customer cache and supports filtered lists", async () => {
    const first = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      phoneNumber,
      text: "I need my balance.",
    });

    await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: first.callSessionId,
      phoneNumber,
      text: "ZIP 94107.",
    });

    const customers = await callRpc<{
      items: Array<{ id: string }>;
    }>("customers/list", { limit: 10 });
    expect(customers.items.some((customer) => customer.id === "cust_001")).toBe(
      true,
    );

    const customer = await callRpc<{
      id: string;
      phoneE164: string;
    }>("customers/get", { customerId: "cust_001" });
    expect(customer.id).toBe("cust_001");

    const calls = await callRpc<{
      items: Array<{ id: string; customerCacheId: string | null }>;
    }>("calls/list", { customerCacheId: "cust_001", limit: 20 });
    expect(
      calls.items.some((call) => call.customerCacheId === "cust_001"),
    ).toBe(true);

    const createdTicket = await callRpc<{ id: string }>("tickets/create", {
      subject: "Test ticket",
      description: "Seed for customer filters.",
      phoneE164: customer.phoneE164,
      customerCacheId: "cust_001",
    });
    expect(createdTicket.id).toBeTypeOf("string");

    const tickets = await callRpc<{
      items: Array<{ id: string }>;
    }>("tickets/list", { customerCacheId: "cust_001", limit: 10 });
    expect(tickets.items.some((ticket) => ticket.id === createdTicket.id)).toBe(
      true,
    );
  });

  it("hydrates appointments when refresh is requested", async () => {
    const response = await callRpc<{
      items: Array<{ id: string }>;
    }>("appointments/list", { refresh: true, limit: 10 });
    expect(response.items.length).toBeGreaterThan(0);
  });
});

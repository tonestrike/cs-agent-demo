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
    expect(toolNames).toContain("crm.getNextAppointment");

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

    const second = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: first.callSessionId,
      phoneNumber,
      text: "My ZIP is 94107.",
    });

    expect(second.replyText.length).toBeGreaterThan(0);

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

    const second = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: first.callSessionId,
      phoneNumber,
      text: "Please reschedule to the next available slot.",
    });

    expect(second.replyText.length).toBeGreaterThan(0);

    const meta = await getLatestAgentTurnMeta(second.callSessionId);
    const toolNames = (meta.tools ?? []).map((tool) => tool.toolName);
    expect(toolNames).toContain("crm.getNextAppointment");
    expect(toolNames).toContain("crm.getAvailableSlots");
    expect(toolNames).toContain("crm.rescheduleAppointment");
    assertRealModelCalls(meta.modelCalls ?? []);
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
    expect(response.replyText.toLowerCase()).toContain("specialist");
    expect(response.ticketId).toBeTruthy();

    const meta = await getLatestAgentTurnMeta(response.callSessionId);
    const toolNames = (meta.tools ?? []).map((tool) => tool.toolName);
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

  it("disambiguates multiple customers before disclosing details", async () => {
    const first = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      phoneNumber: multiMatchPhone,
      text: "When is my next appointment?",
    });

    expect(first.replyText.toLowerCase()).toContain("multiple");
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
    expect(toolNames).toContain("crm.getNextAppointment");
    expect(meta.customerId).toBe("cust_003");

    const modelCalls = meta.modelCalls ?? [];
    expect(modelCalls.length).toBeGreaterThan(0);
    assertRealModelCalls(modelCalls);
  });
});

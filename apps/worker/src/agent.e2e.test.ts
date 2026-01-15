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
  E2E_EXPECT_REAL_MODEL?: string;
  E2E_EXPECT_MODEL_NAME?: string;
  E2E_EXPECT_MODEL_ID?: string;
}

const env = process.env as E2EEnv;
const baseUrl = env.E2E_BASE_URL ?? "http://127.0.0.1:8787";
const authToken = env.E2E_AUTH_TOKEN ?? env.DEMO_AUTH_TOKEN;
const phoneNumber = env.E2E_PHONE ?? "+14155552671";
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
  console.log("expectRealModel", expectRealModel);
  console.log("modelCalls", modelCalls);
  console.log("expectedModelName", expectedModelName);
  console.log("expectedModelId", expectedModelId);
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

  it("records billing tool calls when zip is provided", async () => {
    const response = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      phoneNumber,
      text: "Do I owe anything? My ZIP is 94107.",
    });

    expect(response.replyText.length).toBeGreaterThan(0);

    const meta = await getLatestAgentTurnMeta(response.callSessionId);
    const tools = meta.tools ?? [];
    const toolNames = tools.map((tool) => tool.toolName);
    expect(toolNames).toContain("crm.lookupCustomerByPhone");
    expect(toolNames).toContain("crm.getOpenInvoices");

    const modelCalls = meta.modelCalls ?? [];
    expect(modelCalls.length).toBeGreaterThan(0);
    expect(modelCalls[0]?.modelName).toBeTypeOf("string");
    if (modelCalls[0]?.modelId) {
      expect(modelCalls[0]?.modelId).toBeTypeOf("string");
    }
    assertRealModelCalls(modelCalls);
  });
});

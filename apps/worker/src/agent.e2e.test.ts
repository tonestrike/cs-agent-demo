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
}

const env = process.env as E2EEnv;
const baseUrl = env.E2E_BASE_URL ?? "http://127.0.0.1:8787";
const authToken = env.E2E_AUTH_TOKEN ?? env.DEMO_AUTH_TOKEN;
const phoneNumber = env.E2E_PHONE ?? "+14155552671";

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

const getLatestAgentTools = async (callSessionId: string) => {
  const detail = await callRpc<{
    turns: Array<{
      speaker: string;
      meta: Record<string, unknown>;
    }>;
  }>("calls/get", { callSessionId });

  const agentTurn = [...detail.turns]
    .reverse()
    .find((turn) => turn.speaker === "agent");
  const meta = agentTurn?.meta as { tools?: Array<{ toolName: string }> };
  const tools = meta?.tools ?? [];
  return tools;
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

    const tools = await getLatestAgentTools(response.callSessionId);
    const toolNames = tools.map((tool) => tool.toolName);
    expect(toolNames).toContain("crm.lookupCustomerByPhone");
    expect(toolNames).toContain("crm.getNextAppointment");
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

    const tools = await getLatestAgentTools(response.callSessionId);
    const toolNames = tools.map((tool) => tool.toolName);
    expect(toolNames).toContain("crm.lookupCustomerByPhone");
    expect(toolNames).toContain("crm.getOpenInvoices");
  });
});

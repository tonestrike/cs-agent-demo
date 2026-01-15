import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import { RPCHandler } from "@orpc/server/fetch";
import { createContext } from "./context";
import type { Env } from "./env";
import { router } from "./router";

type RpcResponse<T> = {
  json: T;
  meta: unknown[];
};

type Platform = Awaited<ReturnType<typeof getPlatformProxy<Env>>>;

const handler = new RPCHandler(router);

const callRpc = async <T>(
  platform: Platform,
  path: string,
  input?: Record<string, unknown>,
): Promise<T> => {
  const request = new Request(`http://localhost/rpc/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      json: input ?? {},
      meta: [],
    }),
  });

  const { matched, response } = await handler.handle(request, {
    prefix: "/rpc",
    context: createContext(platform.env, request.headers),
  });

  expect(matched).toBe(true);

  if (!response) {
    throw new Error("Expected a response but got undefined");
  }

  const data = (await response.json()) as RpcResponse<T>;
  if (!response.ok) {
    throw new Error(JSON.stringify(data.json));
  }
  return data.json;
};

const applyMigrations = async (db: D1Database): Promise<void> => {
  const migrationPath = resolve(
    process.cwd(),
    "apps/worker/migrations/0001_init.sql",
  );
  const sql = readFileSync(migrationPath, "utf8");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await db.prepare(`${statement};`).run();
  }
};

const createTestEnv = async (): Promise<Platform> => {
  const platform = await getPlatformProxy<Env>({
    configPath: "apps/worker/wrangler.test.toml",
    persist: false,
    remoteBindings: false,
  });
  platform.env.AGENT_MODEL = "mock";
  await applyMigrations(platform.env.DB);
  return platform;
};

const getLatestAgentTools = async (
  platform: Platform,
  callSessionId: string,
) => {
  const row = await platform.env.DB.prepare(
    "SELECT meta_json FROM call_turns WHERE call_session_id = ? AND speaker = 'agent' ORDER BY ts DESC LIMIT 1",
  )
    .bind(callSessionId)
    .first<{ meta_json: string }>();

  if (!row?.meta_json) {
    return [];
  }

  const parsed = JSON.parse(row.meta_json) as {
    tools?: Array<{ toolName: string }>;
  };
  return parsed.tools ?? [];
};

describe("agent e2e tool calls", () => {
  it("records appointment tool calls with expected data", async () => {
    const platform = await createTestEnv();
    try {
      const response = await callRpc<{
        callSessionId: string;
        replyText: string;
      }>(platform, "agent/message", {
        phoneNumber: "+14155552671",
        text: "When is my next appointment?",
      });

      expect(response.replyText.length).toBeGreaterThan(0);

      const tools = await getLatestAgentTools(platform, response.callSessionId);
      const toolNames = tools.map((tool) => tool.toolName);
      expect(toolNames).toContain("crm.lookupCustomerByPhone");
      expect(toolNames).toContain("crm.getNextAppointment");
    } finally {
      await platform.dispose();
    }
  });

  it("records billing tool calls when zip is provided", async () => {
    const platform = await createTestEnv();
    try {
      const response = await callRpc<{
        callSessionId: string;
        replyText: string;
      }>(platform, "agent/message", {
        phoneNumber: "+14155552671",
        text: "Do I owe anything? My ZIP is 94107.",
      });

      expect(response.replyText.length).toBeGreaterThan(0);

      const tools = await getLatestAgentTools(platform, response.callSessionId);
      const toolNames = tools.map((tool) => tool.toolName);
      expect(toolNames).toContain("crm.lookupCustomerByPhone");
      expect(toolNames).toContain("crm.getOpenInvoices");
    } finally {
      await platform.dispose();
    }
  });
});

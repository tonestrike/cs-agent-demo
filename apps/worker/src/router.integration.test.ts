import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
const migrationPath = resolve(
  process.cwd(),
  "apps/worker/migrations/0001_init.sql",
);

const splitSqlStatements = (sql: string): string[] => {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
};

const applyMigrations = async (env: Env): Promise<void> => {
  const sql = readFileSync(migrationPath, "utf8");
  const statements = splitSqlStatements(sql);
  for (const statement of statements) {
    if (statement.trim().length === 0) {
      continue;
    }
    await env.DB.prepare(statement).run();
  }
};

const resetTables = async (env: Env): Promise<void> => {
  const statements = [
    "DELETE FROM ticket_events",
    "DELETE FROM tickets",
    "DELETE FROM call_turns",
    "DELETE FROM call_sessions",
    "DELETE FROM customers_cache",
  ];
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
};

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

let platform: Platform;

beforeAll(async () => {
  platform = await getPlatformProxy<Env>({
    configPath: "apps/worker/wrangler.toml",
    persist: false,
    remoteBindings: false,
  });
  await applyMigrations(platform.env);
});

afterAll(async () => {
  await platform.dispose();
});

beforeEach(async () => {
  await resetTables(platform.env);
});

describe("tickets RPC", () => {
  it("creates, reads, lists, and updates ticket status", async () => {
    const created = await callRpc<{
      id: string;
      subject: string;
      status: string;
    }>(platform, "tickets/create", {
      subject: "Ants in the kitchen",
      description: "Customer reports ants near the sink.",
      source: "internal",
    });

    expect(created.subject).toBe("Ants in the kitchen");
    expect(created.status).toBe("open");

    const fetched = await callRpc<{ id: string; status: string }>(
      platform,
      "tickets/get",
      {
        ticketId: created.id,
      },
    );

    expect(fetched.id).toBe(created.id);

    const list = await callRpc<{
      items: { id: string }[];
      nextCursor: string | null;
    }>(platform, "tickets/list", {
      limit: 10,
    });

    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.id).toBe(created.id);

    const updated = await callRpc<{ id: string; status: string }>(
      platform,
      "tickets/setStatus",
      {
        ticketId: created.id,
        status: "resolved",
      },
    );

    expect(updated.status).toBe("resolved");
  });
});

describe("crm RPC", () => {
  it("returns mock customer data and appointment details", async () => {
    const customers = await callRpc<
      {
        id: string;
        displayName: string;
        phoneE164: string;
      }[]
    >(platform, "crm/lookupCustomerByPhone", {
      phoneE164: "+14155552671",
    });

    expect(customers).toHaveLength(1);
    expect(customers[0]?.id).toBe("cust_001");

    const appointment = await callRpc<{
      id: string;
      date: string;
      timeWindow: string;
    }>(platform, "crm/getNextAppointment", {
      customerId: "cust_001",
    });

    expect(appointment?.id).toBe("appt_001");
    expect(appointment?.date).toBe("2025-02-10");

    const invoices = await callRpc<
      {
        id: string;
        balanceCents: number;
        status: string;
      }[]
    >(platform, "crm/getOpenInvoices", {
      customerId: "cust_001",
    });

    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.balanceCents).toBe(12900);
    expect(invoices[0]?.status).toBe("open");

    const slots = await callRpc<
      {
        id: string;
        date: string;
        timeWindow: string;
      }[]
    >(platform, "crm/getAvailableSlots", {
      customerId: "cust_001",
      window: { from: "2025-02-13", to: "2025-02-20" },
    });

    expect(slots.length).toBeGreaterThan(0);
  });
});

describe("agent RPC", () => {
  it("creates a call session and replies with appointment info", async () => {
    const response = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>(platform, "agent/message", {
      phoneNumber: "+14155552671",
      text: "When is my next appointment?",
    });

    expect(response.callSessionId.length).toBeGreaterThan(0);
    expect(response.replyText).toContain("Your next appointment is");
  });
});

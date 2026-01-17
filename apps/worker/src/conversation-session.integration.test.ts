import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import type { Env } from "./env";

type Platform = Awaited<ReturnType<typeof getPlatformProxy<Env>>>;

const applyMigrations = async (db: D1Database): Promise<void> => {
  const migrationsDir = resolve(process.cwd(), "apps/worker/migrations");
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => resolve(migrationsDir, file));

  for (const migrationPath of migrations) {
    const sql = readFileSync(migrationPath, "utf8");
    const statements = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await db.prepare(`${statement};`).run();
    }
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

describe.skip("conversation session durable object", () => {
  it("persists events and supports resync", async () => {
    const platform = await createTestEnv();
    const namespace = platform.env.CONVERSATION_SESSION;
    if (!namespace) {
      throw new Error("CONVERSATION_SESSION binding not available.");
    }
    const id = namespace.idFromName("conv_test");
    const stub = namespace.get(id);

    const messageResponse = await stub.fetch(
      "https://conversation-session/message",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phoneNumber: "+14155550123",
          text: "hello",
        }),
      },
    );

    expect(messageResponse.ok).toBe(true);
    const messageBody = (await messageResponse.json()) as {
      callSessionId: string;
      replyText: string;
    };
    expect(messageBody.callSessionId).toBeTruthy();
    expect(messageBody.replyText.length).toBeGreaterThan(0);

    const resyncResponse = await stub.fetch(
      "https://conversation-session/resync",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lastEventId: 0 }),
      },
    );

    expect(resyncResponse.ok).toBe(true);
    const resyncBody = (await resyncResponse.json()) as {
      events: Array<{ type: string; data?: { callSessionId?: string } }>;
      speaking: boolean;
      latestEventId: number;
    };
    expect(resyncBody.events.length).toBeGreaterThan(0);
    expect(resyncBody.events.some((event) => event.type === "final")).toBe(
      true,
    );
    expect(resyncBody.latestEventId).toBeGreaterThan(0);
  });

  it("rejects invalid message payloads", async () => {
    const platform = await createTestEnv();
    const namespace = platform.env.CONVERSATION_SESSION;
    if (!namespace) {
      throw new Error("CONVERSATION_SESSION binding not available.");
    }
    const id = namespace.idFromName("conv_invalid");
    const stub = namespace.get(id);

    const response = await stub.fetch("https://conversation-session/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });
});

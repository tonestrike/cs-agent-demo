import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const wranglerBin = "./node_modules/.bin/wrangler";
const wranglerConfig = "apps/worker/wrangler.toml";
const dbName = "pestcall_local";

const runWrangler = (args: string[]): string => {
  return execFileSync(wranglerBin, args, {
    encoding: "utf8",
  });
};

describe("D1 integration", () => {
  it("stores and reads a ticket in the local D1 database", () => {
    runWrangler([
      "d1",
      "migrations",
      "apply",
      dbName,
      "--local",
      "--config",
      wranglerConfig,
    ]);

    const ticketId = `test-${Date.now()}`;
    const createdAt = new Date().toISOString();

    runWrangler([
      "d1",
      "execute",
      dbName,
      "--local",
      "--config",
      wranglerConfig,
      "--command",
      `INSERT INTO tickets (id, created_at, updated_at, status, priority, category, subject, description, source) VALUES ('${ticketId}', '${createdAt}', '${createdAt}', 'open', 'normal', 'general', 'Test ticket', 'Created by integration test', 'internal')`,
    ]);

    const output = runWrangler([
      "d1",
      "execute",
      dbName,
      "--local",
      "--config",
      wranglerConfig,
      "--command",
      `SELECT id, status FROM tickets WHERE id = '${ticketId}'`,
      "--json",
    ]);

    expect(output).toContain(ticketId);
    expect(output).toContain("open");
  });
});

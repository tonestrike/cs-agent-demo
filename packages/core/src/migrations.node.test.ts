import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "apps/worker/migrations/0001_init.sql",
);

const requiredTables = [
  "customers_cache",
  "call_sessions",
  "call_turns",
  "tickets",
  "ticket_events",
];

describe("D1 migration", () => {
  it("contains the required tables", () => {
    const sql = readFileSync(migrationPath, "utf8");

    for (const table of requiredTables) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });
});

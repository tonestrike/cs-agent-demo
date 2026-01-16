import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = Number(process.env.E2E_PORT ?? 8787);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const useRemote = Boolean(process.env.E2E_BASE_URL);

const waitForServer = async (url: string, attempts = 40) => {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(new URL("/__health", url), {
        method: "GET",
      });
      if (res.ok || res.status === 404) {
        return;
      }
    } catch {
      // ignore until next attempt
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for local worker to start.");
};

export default async function setup() {
  if (useRemote) {
    process.env.E2E_BASE_URL = BASE_URL;
    return async () => {};
  }

  const wrangler = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--local",
      "--port",
      String(PORT),
      "--config",
      "apps/worker/wrangler.test.toml",
    ],
    {
      stdio: "inherit",
    },
  );

  wrangler.on("error", (error) => {
    throw error;
  });

  await waitForServer(BASE_URL);
  const migrate = spawn(
    "npx",
    [
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "pestcall_local",
      "--local",
      "--config",
      "apps/worker/wrangler.test.toml",
    ],
    {
      stdio: "inherit",
    },
  );
  const migrateExit = await new Promise<number>((resolve) => {
    migrate.on("close", (code) => resolve(code ?? 1));
  });
  if (migrateExit !== 0) {
    throw new Error("Failed to apply local D1 migrations for e2e.");
  }

  const reset = spawn(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "pestcall_local",
      "--local",
      "--config",
      "apps/worker/wrangler.test.toml",
      "--command",
      [
        "DELETE FROM ticket_events;",
        "DELETE FROM tickets;",
        "DELETE FROM call_turns;",
        "DELETE FROM call_sessions;",
        "DELETE FROM appointments;",
        "DELETE FROM customers_cache;",
      ].join(" "),
    ],
    {
      stdio: "inherit",
    },
  );
  const resetExit = await new Promise<number>((resolve) => {
    reset.on("close", (code) => resolve(code ?? 1));
  });
  if (resetExit !== 0) {
    throw new Error("Failed to reset local D1 tables for e2e.");
  }

  const seed = spawn(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "pestcall_local",
      "--local",
      "--config",
      "apps/worker/wrangler.test.toml",
      "--file",
      "apps/worker/seeds/20250201120000_seed.sql",
    ],
    {
      stdio: "inherit",
    },
  );
  const seedExit = await new Promise<number>((resolve) => {
    seed.on("close", (code) => resolve(code ?? 1));
  });
  if (seedExit !== 0) {
    throw new Error("Failed to seed local D1 data for e2e.");
  }
  process.env.E2E_BASE_URL = BASE_URL;

  return async () => {
    wrangler.kill("SIGTERM");
  };
}

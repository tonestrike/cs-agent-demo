import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = Number(process.env.E2E_PORT ?? 8787);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

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
  process.env.E2E_BASE_URL = BASE_URL;

  return async () => {
    wrangler.kill("SIGTERM");
  };
}

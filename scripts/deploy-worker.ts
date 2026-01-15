import "dotenv/config";
import { type ChildProcessByStdio, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import { Command } from "commander";

type D1DatabaseInfo = {
  name: string;
  uuid: string;
};

const WORKER_DIR = resolve(process.cwd(), "apps/worker");
const WRANGLER_CONFIG = resolve(WORKER_DIR, "wrangler.toml");

const runWrangler = async (args: string[], options?: { quiet?: boolean }) => {
  return new Promise<{ stdout: string; stderr: string }>(
    (resolvePromise, reject) => {
      const proc: ChildProcessByStdio<null, Readable, Readable> = spawn(
        "bunx",
        ["wrangler", ...args],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on("error", (error) => {
        reject(error);
      });
      proc.on("close", (code) => {
        if (!options?.quiet) {
          if (stdout.trim()) {
            process.stdout.write(stdout);
          }
          if (stderr.trim()) {
            process.stderr.write(stderr);
          }
        }
        if (code !== 0) {
          reject(new Error(stderr || stdout || "Wrangler command failed."));
          return;
        }
        resolvePromise({ stdout, stderr });
      });
    },
  );
};

const parseD1Name = (content: string) => {
  const match = content.match(/database_name\s*=\s*"([^"]+)"/);
  return match?.[1];
};

const updateDatabaseId = async (content: string, databaseId: string) => {
  const updated = content.replace(
    /database_id\s*=\s*"[^"]*"/,
    `database_id = "${databaseId}"`,
  );
  await writeFile(WRANGLER_CONFIG, updated, "utf8");
};

const parseD1List = (output: string) => {
  const entries: D1DatabaseInfo[] = [];
  const lines = output.split("\n");
  for (const line of lines) {
    if (
      line.includes("│") &&
      !line.includes("Account") &&
      !line.includes("Name")
    ) {
      const parts = line
        .split("│")
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length >= 2) {
        const uuid = parts[0] ?? "";
        const name = parts[1] ?? "";
        if (name && uuid) {
          entries.push({ name, uuid });
        }
      }
    }
  }
  return entries;
};

const parseD1Create = (output: string) => {
  const uuidMatch = output.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  return uuidMatch?.[0] ?? null;
};

const getD1DatabaseId = async (dbName: string) => {
  const list = await runWrangler(["d1", "list"], { quiet: true });
  const parsed = parseD1List(list.stdout);
  const existing = parsed.find((db) => db.name === dbName);
  if (existing) {
    return existing.uuid;
  }

  const created = await runWrangler(["d1", "create", dbName], { quiet: true });
  const uuid = parseD1Create(created.stdout) ?? parseD1Create(created.stderr);
  if (!uuid) {
    throw new Error("Could not determine D1 database id from wrangler output.");
  }
  return uuid;
};

const deploy = async (options: { seed: boolean }) => {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.warn(
      "CLOUDFLARE_API_TOKEN is not set. Falling back to Wrangler login session.",
    );
  }

  const wranglerToml = await readFile(WRANGLER_CONFIG, "utf8");
  const dbName = parseD1Name(wranglerToml);
  if (!dbName) {
    throw new Error("Could not find database_name in wrangler.toml.");
  }

  const databaseId = await getD1DatabaseId(dbName);
  if (!wranglerToml.includes(`database_id = "${databaseId}"`)) {
    await updateDatabaseId(wranglerToml, databaseId);
    console.log(`Updated D1 database_id to ${databaseId}.`);
  }

  await runWrangler([
    "d1",
    "migrations",
    "apply",
    dbName,
    "--remote",
    "--config",
    WRANGLER_CONFIG,
  ]);

  if (options.seed) {
    await runWrangler([
      "d1",
      "execute",
      dbName,
      "--remote",
      "--config",
      WRANGLER_CONFIG,
      "--file",
      resolve(WORKER_DIR, "seeds/20250201120000_seed.sql"),
    ]);
  }

  await runWrangler(["deploy", "--config", WRANGLER_CONFIG]);
};

const program = new Command();

program
  .name("deploy-worker")
  .description("Deploy the PestCall Worker and D1 database.")
  .option("--seed", "Seed demo data")
  .action(async (options: { seed?: boolean }) => {
    try {
      await deploy({ seed: options.seed ?? false });
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Deployment failed.",
      );
      process.exit(1);
    }
  });

program.parse();

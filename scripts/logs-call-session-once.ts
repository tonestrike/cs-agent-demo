import { spawn } from "node:child_process";

const callSessionId = process.argv[2];
const durationSeconds = Number(process.argv[3] ?? "15");

if (!callSessionId) {
  console.error(
    "Usage: bun scripts/logs-call-session-once.ts <callSessionId> [durationSeconds=15]",
  );
  process.exit(1);
}

const args = [
  "wrangler",
  "tail",
  "pestcall-worker",
  "--format",
  "pretty",
  "--search",
  `callSessionId: '${callSessionId}'`,
];

const child = spawn("bunx", args, { stdio: "inherit" });

const timer = setTimeout(() => {
  console.error(
    `Stopping tail after ${durationSeconds}s (callSessionId=${callSessionId}).`,
  );
  child.kill("SIGINT");
}, durationSeconds * 1000);

child.on("exit", (code) => {
  clearTimeout(timer);
  process.exit(code ?? 0);
});

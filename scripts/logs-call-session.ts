import { spawn } from "node:child_process";

const callSessionId = process.argv[2];
if (!callSessionId) {
  console.error("Usage: bun scripts/logs-call-session.ts <callSessionId>");
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
child.on("exit", (code) => {
  process.exit(code ?? 0);
});

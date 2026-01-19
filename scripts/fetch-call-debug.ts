/**
 * Fetches the conversation-session /debug snapshot for a callSessionId.
 *
 * Usage:
 *   WORKER_BASE=https://your-worker.example
 *   DEMO_AUTH_TOKEN=xxx
 *   bun scripts/fetch-call-debug.ts <callSessionId>
 *
 * The script prints the raw JSON to stdout.
 */

const callSessionId = process.argv[2];
const baseUrl = process.env.WORKER_BASE;
const token = process.env.DEMO_AUTH_TOKEN;

if (!callSessionId) {
  console.error("Usage: bun scripts/fetch-call-debug.ts <callSessionId>");
  process.exit(1);
}
if (!baseUrl) {
  console.error("Set WORKER_BASE (e.g. https://pestcall-worker.example)");
  process.exit(1);
}

const headers: Record<string, string> = {};
if (token) {
  headers["x-demo-auth"] = token;
} else {
  console.warn("DEMO_AUTH_TOKEN not set; request may be rejected");
}

const url = `${baseUrl.replace(/\/$/, "")}/api/conversations/${callSessionId}/debug`;

try {
  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    console.error(`Request failed (${response.status} ${response.statusText})`);
  }
  console.log(text);
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  console.error(
    "Request failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}

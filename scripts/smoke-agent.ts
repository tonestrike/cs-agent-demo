import "dotenv/config";

const endpoint = process.env.SMOKE_BASE_URL ?? "https://pestcall-worker.tonyvantur.workers.dev";
const token = process.env.DEMO_AUTH_TOKEN ?? "";
const phoneNumber = process.env.SMOKE_PHONE ?? "+14155552671";
const text = process.env.SMOKE_TEXT ?? "When is my next appointment?";

if (!endpoint) {
  console.error("Missing SMOKE_BASE_URL (e.g. https://<worker>.workers.dev).");
  process.exit(1);
}

const url = new URL("/rpc/agent/message", endpoint).toString();

const response = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(token ? { "x-demo-auth": token } : {}),
  },
  body: JSON.stringify({ phoneNumber, text }),
});

const body = await response.json().catch(() => null);
if (!response.ok) {
  console.error("Agent request failed.", {
    status: response.status,
    body,
  });
  process.exit(1);
}

console.log("Agent response:", body);

/**
 * Simple test of the full conversation flow.
 */

const BASE_URL =
  process.env.WORKER_URL || "https://pestcall-worker.tonyvantur.workers.dev";
const AUTH_TOKEN = process.env.DEMO_AUTH_TOKEN || "test-token";
const TEST_PHONE = "+14155550987";

async function sendMessage(
  conversationId: string,
  message: string,
): Promise<{ response: string }> {
  const response = await fetch(
    `${BASE_URL}/api/conversations/${conversationId}/message`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-demo-auth": AUTH_TOKEN,
      },
      body: JSON.stringify({ text: message, phoneNumber: TEST_PHONE }),
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

async function test() {
  const id = `test-full-flow-${Date.now()}`;
  console.log("Conversation ID:", id);
  console.log("Worker URL:", BASE_URL);
  console.log("");

  // Step 1: Verify
  console.log("--- Step 1: Verify ---");
  console.log("User: My ZIP code is 98109");
  const r1 = await sendMessage(id, "My ZIP code is 98109");
  console.log("Bot:", r1.response);
  console.log("");

  // Step 2: Ask to reschedule
  console.log("--- Step 2: Ask to reschedule ---");
  console.log("User: I want to reschedule my appointment");
  const r2 = await sendMessage(id, "I want to reschedule my appointment");
  console.log("Bot:", r2.response);
  console.log("");

  // Step 3: Ask to cancel instead
  console.log("--- Step 3: Ask to cancel ---");
  console.log("User: Actually, can you just cancel it?");
  const r3 = await sendMessage(id, "Actually, can you just cancel it?");
  console.log("Bot:", r3.response);
  console.log("");

  // Step 4: Confirm
  console.log("--- Step 4: Confirm ---");
  console.log("User: Yes please");
  const r4 = await sendMessage(id, "Yes please");
  console.log("Bot:", r4.response);
}

test().catch(console.error);

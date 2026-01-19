/**
 * Test script for the cancel appointment scenario.
 * Verifies that function calling works end-to-end through the conversation API.
 */

const BASE_URL = process.env.WORKER_URL || "http://localhost:8787";
const AUTH_TOKEN = process.env.DEMO_AUTH_TOKEN || "test-token";

// Morgan Lee's test data (from crm/fixtures.ts)
const TEST_ZIP = "98109";
const TEST_PHONE = "+14155550987";

async function sendMessage(
  conversationId: string,
  message: string,
  phoneNumber?: string,
): Promise<{
  response: string;
  toolCalls?: Array<{ tool: string; args: unknown; result: unknown }>;
}> {
  const url = `${BASE_URL}/api/conversations/${conversationId}/message`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-demo-auth": AUTH_TOKEN,
    },
    body: JSON.stringify({ text: message, phoneNumber }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

async function getDebugState(conversationId: string): Promise<{
  eventBuffer: Array<{ kind: string; data: unknown }>;
  state: unknown;
}> {
  const url = `${BASE_URL}/api/conversations/${conversationId}/debug`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-demo-auth": AUTH_TOKEN,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const json = (await response.json()) as {
    eventBuffer?: Array<{ type: string; data: unknown }>;
  };
  return { eventBuffer: json.eventBuffer ?? [], state: json };
}

function extractToolCalls(
  events: Array<{ type: string; data: unknown }>,
): Array<{
  tool: string;
  args: unknown;
  result: unknown;
}> {
  const toolCalls: Array<{ tool: string; args: unknown; result: unknown }> = [];

  for (const event of events) {
    // The event type is "tool_call" and data contains toolName, args, and result together
    if (event.type === "tool_call") {
      const data = event.data as {
        toolName: string;
        args: unknown;
        result: unknown;
      };
      toolCalls.push({
        tool: data.toolName,
        args: data.args,
        result: data.result,
      });
    }
  }

  return toolCalls;
}

async function runCancelScenario() {
  const conversationId = `test-cancel-${Date.now()}`;

  console.log("=".repeat(60));
  console.log("CANCEL SCENARIO TEST");
  console.log(`Conversation ID: ${conversationId}`);
  console.log(`Worker URL: ${BASE_URL}`);
  console.log("=".repeat(60));
  console.log();

  // Step 1: Verify with ZIP code (include phone number for lookup)
  console.log("STEP 1: Verify account with ZIP code");
  console.log("-".repeat(40));
  console.log(`User: My ZIP code is ${TEST_ZIP}`);
  console.log(`(Phone: ${TEST_PHONE})`);

  try {
    const step1 = await sendMessage(
      conversationId,
      `My ZIP code is ${TEST_ZIP}`,
      TEST_PHONE,
    );
    console.log(`Bot: ${step1.response}`);

    const debug1 = await getDebugState(conversationId);
    const toolCalls1 = extractToolCalls(debug1.eventBuffer);

    if (toolCalls1.length > 0) {
      console.log("\nTool calls:");
      for (const tc of toolCalls1) {
        console.log(`  - ${tc.tool}(${JSON.stringify(tc.args)})`);
        console.log(`    Result: ${JSON.stringify(tc.result)}`);
      }
    } else {
      console.log("\n⚠️ WARNING: No tool calls detected for verification!");
    }

    const verifyCall = toolCalls1.find((tc) => tc.tool === "crm.verifyAccount");
    if (!verifyCall) {
      console.log("\n❌ FAILED: crm.verifyAccount was not called!");
      return;
    }

    console.log("\n✅ Verification step passed");
    console.log();

    // Step 2: Ask to cancel appointment
    console.log("STEP 2: Ask to cancel appointment");
    console.log("-".repeat(40));
    console.log("User: I need to cancel my appointment");

    const step2 = await sendMessage(
      conversationId,
      "I need to cancel my appointment",
      TEST_PHONE,
    );
    console.log(`Bot: ${step2.response}`);

    const debug2 = await getDebugState(conversationId);
    const toolCalls2 = extractToolCalls(debug2.eventBuffer);
    const newToolCalls2 = toolCalls2.filter(
      (tc) =>
        !toolCalls1.some(
          (t1) =>
            t1.tool === tc.tool &&
            JSON.stringify(t1.args) === JSON.stringify(tc.args),
        ),
    );

    if (newToolCalls2.length > 0) {
      console.log("\nNew tool calls:");
      for (const tc of newToolCalls2) {
        console.log(`  - ${tc.tool}(${JSON.stringify(tc.args)})`);
        console.log(`    Result: ${JSON.stringify(tc.result)}`);
      }
    }

    const listCall = toolCalls2.find(
      (tc) => tc.tool === "crm.listUpcomingAppointments",
    );
    if (!listCall) {
      console.log("\n⚠️ WARNING: crm.listUpcomingAppointments was not called");
    } else {
      console.log("\n✅ Appointments listed");
    }
    console.log();

    // Step 3: Confirm cancellation
    console.log("STEP 3: Confirm cancellation");
    console.log("-".repeat(40));
    console.log("User: Yes, please cancel it");

    const step3 = await sendMessage(
      conversationId,
      "Yes, please cancel it",
      TEST_PHONE,
    );
    console.log(`Bot: ${step3.response}`);

    const debug3 = await getDebugState(conversationId);
    const toolCalls3 = extractToolCalls(debug3.eventBuffer);
    const newToolCalls3 = toolCalls3.filter(
      (tc) =>
        !toolCalls2.some(
          (t2) =>
            t2.tool === tc.tool &&
            JSON.stringify(t2.args) === JSON.stringify(tc.args),
        ),
    );

    if (newToolCalls3.length > 0) {
      console.log("\nNew tool calls:");
      for (const tc of newToolCalls3) {
        console.log(`  - ${tc.tool}(${JSON.stringify(tc.args)})`);
        console.log(`    Result: ${JSON.stringify(tc.result)}`);
      }
    }

    const cancelCall = toolCalls3.find(
      (tc) => tc.tool === "crm.cancelAppointment",
    );
    if (!cancelCall) {
      console.log("\n❌ FAILED: crm.cancelAppointment was NOT called!");
      console.log(
        "The bot said 'cancelled' but didn't actually call the tool.",
      );
    } else {
      console.log(
        "\n✅ Cancel tool was called - appointment actually cancelled!",
      );
    }

    console.log();
    console.log("=".repeat(60));
    console.log("TEST COMPLETE");
    console.log("=".repeat(60));

    // Summary
    console.log("\nSummary:");
    console.log(`  Total tool calls: ${toolCalls3.length}`);
    console.log(`  Verification: ${verifyCall ? "✅" : "❌"}`);
    console.log(`  List appointments: ${listCall ? "✅" : "❌"}`);
    console.log(`  Cancel appointment: ${cancelCall ? "✅" : "❌"}`);
  } catch (error) {
    console.error(
      "\n❌ Error:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

runCancelScenario().catch(console.error);

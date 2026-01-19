const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID =
  process.env.CLOUDFLARE_ACCOUNT_ID || "197ac8ab6d5079d3faab60cea42eaa7e";

if (!API_TOKEN) {
  console.error("CLOUDFLARE_API_TOKEN environment variable is required");
  process.exit(1);
}

async function testFunctionCalling() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@hf/nousresearch/hermes-2-pro-mistral-7b`;

  const body = {
    messages: [
      {
        role: "system",
        content: "You are a helpful assistant that uses tools when needed.",
      },
      {
        role: "user",
        content: "My zip code is 98109. Please verify my account.",
      },
    ],
    tools: [
      {
        name: "verify_account",
        description:
          "Verify a customer account using their ZIP code. Call this when the customer provides their ZIP code.",
        parameters: {
          type: "object",
          properties: {
            zipCode: {
              type: "string",
              description: "5-digit ZIP code provided by the customer",
            },
          },
          required: ["zipCode"],
        },
      },
    ],
  };

  console.log("Request body:", JSON.stringify(body, null, 2));
  console.log("\nSending request to Cloudflare AI...\n");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();

  console.log("Response status:", response.status);
  console.log("Response:", JSON.stringify(result, null, 2));

  // Check if there are tool_calls
  if (result.result?.tool_calls) {
    console.log("\n✅ Tool calls detected!");
  } else if (result.result?.response) {
    console.log(
      "\n❌ No tool calls - model returned text response:",
      result.result.response,
    );
  }
}

testFunctionCalling().catch(console.error);

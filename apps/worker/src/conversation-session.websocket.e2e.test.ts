import "dotenv/config";
import { describe, expect, it } from "vitest";

interface E2EEnv {
  E2E_BASE_URL?: string;
  E2E_AUTH_TOKEN?: string;
  DEMO_AUTH_TOKEN?: string;
  E2E_PHONE?: string;
  E2E_ZIP?: string;
}

const env = process.env as E2EEnv;
const baseUrl = env.E2E_BASE_URL ?? "http://127.0.0.1:8787";
const authToken = env.E2E_AUTH_TOKEN ?? env.DEMO_AUTH_TOKEN ?? "";
const generatePhone = () => {
  const suffix = Math.floor(Math.random() * 10_000_000)
    .toString()
    .padStart(7, "0");
  return `+1415${suffix}`;
};
const phoneNumber = env.E2E_PHONE ?? generatePhone();
const zipCode = env.E2E_ZIP ?? "00000";

const describeIf = env.E2E_BASE_URL ? describe : describe.skip;

const waitForFinalEvent = (socket: WebSocket) =>
  new Promise<{ data: unknown }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for final event."));
    }, 10000);
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as {
          type?: string;
          data?: unknown;
        };
        if (payload.type === "final") {
          clearTimeout(timeout);
          resolve({ data: payload.data });
        }
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  });

describeIf("conversation session websocket e2e", () => {
  it("streams events and returns final payload", async () => {
    const conversationId = `e2e-ws-${crypto.randomUUID()}`;
    const url = new URL(`/api/conversations/${conversationId}/socket`, baseUrl);
    if (authToken) {
      url.searchParams.set("token", authToken);
    }
    const socket = new WebSocket(url.toString());

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () =>
        reject(new Error("WebSocket failed to connect.")),
      );
    });

    const createCustomer = new Request(
      new URL("/rpc/admin/createCustomer", baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authToken ? { "x-demo-auth": authToken } : {}),
        },
        body: JSON.stringify({
          json: {
            displayName: "E2E WebSocket Customer",
            phoneE164: phoneNumber,
            addressSummary: "100 Test Street",
            zipCode,
          },
          meta: [],
        }),
      },
    );
    const customerResponse = await fetch(createCustomer);
    if (!customerResponse.ok) {
      throw new Error("Failed to seed customer for WebSocket e2e.");
    }

    socket.send(
      JSON.stringify({
        type: "message",
        phoneNumber,
        text: "hello",
      }),
    );

    const finalEvent = await waitForFinalEvent(socket);
    const payload = finalEvent.data as { callSessionId?: string };
    expect(payload.callSessionId).toBeTruthy();
    socket.send(
      JSON.stringify({
        type: "message",
        phoneNumber,
        callSessionId: payload.callSessionId,
        text: zipCode,
      }),
    );
    socket.close();
  });
});

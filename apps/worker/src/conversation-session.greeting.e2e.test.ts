import "dotenv/config";
import { describe, expect, it } from "vitest";

interface E2EEnv {
  E2E_BASE_URL?: string;
  E2E_AUTH_TOKEN?: string;
  DEMO_AUTH_TOKEN?: string;
  E2E_PHONE?: string;
}

const env = process.env as E2EEnv;
const baseUrl = env.E2E_BASE_URL ?? "http://127.0.0.1:8787";
const authToken = env.E2E_AUTH_TOKEN ?? env.DEMO_AUTH_TOKEN;
const phoneNumber = env.E2E_PHONE ?? "+14155552671";

type SessionEvent = {
  type?: string;
  text?: string;
  turnId?: number | null;
  messageId?: string | null;
};

type WsLike = {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "open" | "message" | "error",
    listener: (event: { data?: unknown }) => void,
  ): void;
  removeEventListener(
    type: "open" | "message" | "error",
    listener: (event: { data?: unknown }) => void,
  ): void;
};

const createWebSocket = (url: string): WsLike => {
  const WS = (globalThis as { WebSocket?: new (url: string) => WsLike })
    .WebSocket;
  if (!WS) {
    throw new Error("WebSocket is not available in this environment");
  }
  return new WS(url);
};

const buildWsUrl = (conversationId: string) => {
  const url = new URL(`/api/conversations/${conversationId}/socket`, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("callSessionId", conversationId);
  if (authToken) {
    url.searchParams.set("token", authToken);
  }
  return url.toString();
};

const waitForEvent = (
  ws: WsLike,
  predicate: (event: SessionEvent) => boolean,
  timeoutMs = 8000,
): Promise<SessionEvent> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for websocket event")),
      timeoutMs,
    );
    const handleMessage = (event: { data?: unknown }) => {
      try {
        const payload = JSON.parse(String(event.data)) as SessionEvent;
        if (predicate(payload)) {
          clearTimeout(timer);
          ws.removeEventListener("message", handleMessage);
          resolve(payload);
        }
      } catch (error) {
        clearTimeout(timer);
        ws.removeEventListener("message", handleMessage);
        reject(error);
      }
    };
    ws.addEventListener("message", handleMessage);
  });

describe("conversation greeting e2e", () => {
  it("sends greeting and first reply over websocket", async () => {
    const conversationId = `greet-${crypto.randomUUID()}`;
    const ws = createWebSocket(buildWsUrl(conversationId));

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("WebSocket error")));
    });

    const greeting = await waitForEvent(
      ws,
      (event) => event.type === "final" && event.turnId === 0,
    );
    expect(greeting.text?.length ?? 0).toBeGreaterThan(0);
    expect(greeting.messageId).toBeTruthy();

    ws.send(
      JSON.stringify({
        type: "message",
        text: "hello",
        phoneNumber,
        callSessionId: conversationId,
      }),
    );

    const reply = await waitForEvent(
      ws,
      (event) => event.type === "final" && (event.turnId ?? 0) > 0,
    );
    expect(reply.text?.length ?? 0).toBeGreaterThan(0);
    expect(reply.turnId).toBeGreaterThan(0);

    ws.close();
  });
});

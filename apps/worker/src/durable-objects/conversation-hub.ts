import type { Env } from "../env";
import { defaultLogger } from "../logging";

type HubEvent = {
  type: "status" | "delta" | "final";
  text?: string;
  data?: unknown;
};

export class ConversationHub {
  private connections = new Set<WebSocket>();

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      if (!client || !server) {
        return new Response("WebSocket unavailable", { status: 500 });
      }
      server.accept();
      this.connections.add(server);
      server.addEventListener("close", () => {
        this.connections.delete(server);
      });
      server.addEventListener("error", () => {
        this.connections.delete(server);
      });
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "POST" && url.pathname.endsWith("/publish")) {
      const event = (await request.json()) as HubEvent;
      const payload = JSON.stringify(event);
      for (const socket of this.connections) {
        try {
          socket.send(payload);
        } catch (error) {
          defaultLogger.error(
            { error: error instanceof Error ? error.message : "unknown" },
            "conversation-hub.send_failed",
          );
          this.connections.delete(socket);
        }
      }
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  }
}

import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin } from "@orpc/server/plugins";
import { routeAgentRequest } from "agents";

import { createContext } from "./context";
import type { Env } from "./env";
import { createLogger } from "./logger";
import { router } from "./router";
export { PestCallAgent } from "./agents/pestcall";
export { CancelWorkflow } from "./workflows/cancel";
export { ConversationHub } from "./durable-objects/conversation-hub";
export { ConversationSession } from "./durable-objects/conversation-session";
export { RescheduleWorkflow } from "./workflows/reschedule";
export { VerificationWorkflow } from "./workflows/verification";

const fallbackLogger = createLogger({});
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-demo-auth, authorization",
};

const withCors = (response: Response) => {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const handler = new RPCHandler(router, {
  plugins: [
    new CORSPlugin({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type", "x-demo-auth", "authorization"],
    }),
  ],
  interceptors: [
    onError((error) => {
      fallbackLogger.error(
        { error: error instanceof Error ? error.message : error },
        "rpc.handler.error",
      );
    }),
  ],
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const conversationMatch = url.pathname.match(
      /^\/api\/conversations\/([^/]+)\/(socket|message|resync|rtk-token|summary)$/,
    );
    if (conversationMatch) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      if (!env.CONVERSATION_SESSION) {
        return withCors(
          new Response("Conversation session not configured", {
            status: 500,
          }),
        );
      }
      const token =
        request.headers.get("x-demo-auth") ??
        request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
        url.searchParams.get("token") ??
        "";
      if (env.DEMO_AUTH_TOKEN && token !== env.DEMO_AUTH_TOKEN) {
        return withCors(new Response("Unauthorized", { status: 401 }));
      }
      const conversationId = conversationMatch[1] ?? "";
      const action = conversationMatch[2] ?? "";
      if (!conversationId) {
        return withCors(
          new Response("Conversation id required", { status: 400 }),
        );
      }
      const id = env.CONVERSATION_SESSION.idFromName(conversationId);
      const stub = env.CONVERSATION_SESSION.get(id);
      if (action === "socket") {
        return stub.fetch(request);
      }
      const target = `https://conversation-session/${action}?callSessionId=${conversationId}`;
      try {
        const response = await stub.fetch(new Request(target, request));
        return withCors(response);
      } catch (error) {
        const logger = createLogger(env);
        logger.error(
          { error: error instanceof Error ? error.message : "unknown", action },
          "conversation.session.fetch.error",
        );
        return withCors(
          Response.json({ error: "Internal server error" }, { status: 500 }),
        );
      }
    }
    if (url.pathname.startsWith("/ws/conversations/")) {
      if (!env.CONVERSATION_HUB) {
        return new Response("Conversation hub not configured", {
          status: 500,
        });
      }
      const token = url.searchParams.get("token") ?? "";
      if (env.DEMO_AUTH_TOKEN && token !== env.DEMO_AUTH_TOKEN) {
        return new Response("Unauthorized", { status: 401 });
      }
      const conversationId = url.pathname.replace("/ws/conversations/", "");
      if (!conversationId) {
        return new Response("Conversation id required", { status: 400 });
      }
      const id = env.CONVERSATION_HUB.idFromName(conversationId);
      const stub = env.CONVERSATION_HUB.get(id);
      return stub.fetch(request);
    }
    if (url.pathname === "/health/openrouter") {
      const baseUrl = env.OPENROUTER_BASE_URL?.trim() ?? "";
      const token = env.OPENROUTER_TOKEN ?? "";
      if (!baseUrl || !token) {
        return Response.json(
          {
            ok: false,
            error: "OPENROUTER_NOT_CONFIGURED",
            hasBaseUrl: Boolean(baseUrl),
            hasToken: Boolean(token),
          },
          { status: 500 },
        );
      }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      if (env.OPENROUTER_REFERER) {
        headers["HTTP-Referer"] = env.OPENROUTER_REFERER;
      }
      if (env.OPENROUTER_TITLE) {
        headers["X-Title"] = env.OPENROUTER_TITLE;
      }
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "openai/gpt-5-mini",
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      const bodyText = await response.text();
      return Response.json({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        bodyPreview: bodyText.slice(0, 400),
        baseUrl,
      });
    }
    if (request.method === "OPTIONS") {
      if (url.pathname.startsWith("/rpc")) {
        const origin = request.headers.get("Origin") ?? "*";
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods":
              "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers":
              "content-type, x-demo-auth, authorization",
            "Access-Control-Max-Age": "86400",
          },
        });
      }
    }
    const agentResponse = await routeAgentRequest(request, env, {
      cors: true,
    });
    if (agentResponse) {
      return agentResponse;
    }

    const { matched, response } = await handler.handle(request, {
      prefix: "/rpc",
      context: createContext(env, request.headers),
    });

    if (matched) {
      return response;
    }

    return new Response("Not found", { status: 404 });
  },
};

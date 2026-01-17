import type { DurableObjectStub } from "@cloudflare/workers-types";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin } from "@orpc/server/plugins";

import { createContext } from "./context";
import type { Env } from "./env";
import { createLogger } from "./logger";
import { router } from "./router";
export { CancelWorkflow } from "./workflows/cancel";
export { ConversationHub } from "./durable-objects/conversation-hub";
export { ConversationSessionV2DO } from "./durable-objects/conversation-session/v2";
export { RescheduleWorkflow } from "./workflows/reschedule";
export { VerificationWorkflow } from "./workflows/verification";
export { VoiceAgentDO } from "./durable-objects/voice-agent";

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

    // Voice Agent internal routes (used by realtime-agents SDK)
    if (url.pathname.startsWith("/agentsInternal")) {
      const meetingId = url.searchParams.get("meetingId");
      if (!meetingId || !env.VOICE_AGENT) {
        return new Response("Bad Request", { status: 400 });
      }
      const id = env.VOICE_AGENT.idFromName(meetingId);
      const stub = env.VOICE_AGENT.get(id);
      return stub.fetch(request);
    }

    // Voice Agent API routes
    const voiceAgentMatch = url.pathname.match(
      /^\/api\/voice-agent\/([^/]+)\/(init|deinit)$/,
    );
    if (voiceAgentMatch) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      if (!env.VOICE_AGENT) {
        return withCors(
          new Response("Voice agent not configured", { status: 500 }),
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
      const agentId = voiceAgentMatch[1] ?? "";
      const action = voiceAgentMatch[2] ?? "";
      if (!agentId) {
        return withCors(new Response("Agent ID required", { status: 400 }));
      }
      const id = env.VOICE_AGENT.idFromName(agentId);
      const stub = env.VOICE_AGENT.get(id) as DurableObjectStub & {
        init: (
          agentId: string,
          meetingId: string,
          authToken: string,
          workerUrl: string,
          accountId: string,
          apiToken: string,
          options?: { phoneNumber?: string; callSessionId?: string },
        ) => Promise<{ voiceEnabled: boolean }>;
        deinit: () => Promise<void>;
      };
      try {
        if (action === "init" && request.method === "POST") {
          const body = (await request.json()) as {
            meetingId: string;
            authToken: string;
            phoneNumber?: string;
            callSessionId?: string;
          };
          if (!body.meetingId || !body.authToken) {
            return withCors(
              new Response("meetingId and authToken required", { status: 400 }),
            );
          }
          const accountId = env.REALTIMEKIT_ACCOUNT_ID ?? "";
          const apiToken = env.REALTIMEKIT_API_TOKEN ?? "";
          const result = await stub.init(
            agentId,
            body.meetingId,
            body.authToken,
            url.host,
            accountId,
            apiToken,
            {
              phoneNumber: body.phoneNumber,
              callSessionId: body.callSessionId,
            },
          );
          return withCors(
            Response.json({ ok: true, voiceEnabled: result.voiceEnabled }),
          );
        }
        if (action === "deinit" && request.method === "POST") {
          await stub.deinit();
          return withCors(Response.json({ ok: true }));
        }
        return withCors(new Response("Method not allowed", { status: 405 }));
      } catch (error) {
        const logger = createLogger(env);
        logger.error(
          { error: error instanceof Error ? error.message : "unknown", action },
          "voice_agent.route.error",
        );
        return withCors(
          Response.json(
            {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Internal server error",
            },
            { status: 500 },
          ),
        );
      }
    }

    // Conversation Session v2 routes (supports /api/conversations and /api/v2/conversations)
    const conversationMatch = url.pathname.match(
      /^\/api\/(?:v2\/)?conversations\/([^/]+)\/(socket|message|resync|debug|rtk-token|summary)$/,
    );
    if (conversationMatch) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      if (!env.CONVERSATION_SESSION_V2) {
        return withCors(
          new Response("Conversation session v2 not configured", {
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
      const id = env.CONVERSATION_SESSION_V2.idFromName(conversationId);
      const stub = env.CONVERSATION_SESSION_V2.get(id);
      if (action === "socket") {
        return stub.fetch(request);
      }
      const target = `https://conversation-session-v2/${action}?callSessionId=${conversationId}`;
      try {
        const response = await stub.fetch(new Request(target, request));
        return withCors(response);
      } catch (error) {
        const logger = createLogger(env);
        logger.error(
          { error: error instanceof Error ? error.message : "unknown", action },
          "conversation.session.v2.fetch.error",
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

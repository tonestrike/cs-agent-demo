import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin } from "@orpc/server/plugins";
import { routeAgentRequest } from "agents";

import { createContext } from "./context";
import type { Env } from "./env";
import { router } from "./router";
export { PestCallAgent } from "./agents/pestcall";

const handler = new RPCHandler(router, {
  plugins: [
    new CORSPlugin({
      origin: "*",
      allowMethods: ["POST", "OPTIONS"],
      allowHeaders: ["content-type", "x-demo-auth"],
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const agentResponse = await routeAgentRequest(request, env);
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

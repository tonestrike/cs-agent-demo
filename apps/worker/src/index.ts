import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin } from "@orpc/server/plugins";

import { createContext } from "./context";
import type { Env } from "./env";
import { router } from "./router";

const handler = new RPCHandler(router, {
  plugins: [new CORSPlugin()],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

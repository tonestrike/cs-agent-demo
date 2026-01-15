import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin } from "@orpc/server/plugins";

import { type Env, router } from "./router";

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
      context: {
        env,
        headers: request.headers,
      },
    });

    if (matched) {
      return response;
    }

    return new Response("Not found", { status: 404 });
  },
};

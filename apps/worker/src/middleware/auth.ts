import { os, ORPCError } from "@orpc/server";

import type { RequestContext } from "../context";

export const baseProcedure = os.$context<RequestContext>();

export const requireAuth = baseProcedure.middleware(
  async ({ context, next }) => {
    const expected = context.env.DEMO_AUTH_TOKEN;
    if (!expected) {
      return next();
    }

    const provided =
      context.headers.get("x-demo-auth") ??
      context.headers.get("authorization")?.replace("Bearer ", "");

    if (provided && provided === expected) {
      return next();
    }

    throw new ORPCError("UNAUTHORIZED", {
      message: "Missing or invalid demo auth token",
    });
  },
);

export const authedProcedure = baseProcedure.use(requireAuth);

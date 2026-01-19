import type { CrmAdapter } from "@pestcall/core";

import type { Env } from "../env";
import { createD1CrmAdapter } from "./d1";
import { createHttpCrmAdapter } from "./http";
import { mockCrmAdapter } from "./mock";

export const getCrmAdapter = (env: Env): CrmAdapter => {
  const provider = env.CRM_PROVIDER ?? "d1";
  switch (provider) {
    case "http":
      return createHttpCrmAdapter(env);
    case "mock":
      return mockCrmAdapter;
    case "d1":
    default:
      // D1 adapter for real database operations
      return createD1CrmAdapter(env.DB);
  }
};

import type { CrmAdapter } from "@pestcall/core";

import type { Env } from "../env";
import { createHttpCrmAdapter } from "./http";
import { mockCrmAdapter } from "./mock";

export const getCrmAdapter = (env: Env): CrmAdapter => {
  const provider = env.CRM_PROVIDER ?? "mock";
  switch (provider) {
    case "http":
      return createHttpCrmAdapter(env);
    default:
      return mockCrmAdapter;
  }
};

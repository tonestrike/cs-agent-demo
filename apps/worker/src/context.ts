import type { CrmAdapter } from "@pestcall/core";

import { getCrmAdapter } from "./crm";
import { type Env, envSchema } from "./env";
import { getModelAdapter } from "./models";
import { createCallRepository, createTicketRepository } from "./repositories";

export type Dependencies = {
  crm: CrmAdapter;
  tickets: ReturnType<typeof createTicketRepository>;
  calls: ReturnType<typeof createCallRepository>;
  model: ReturnType<typeof getModelAdapter>;
};

export type RequestContext = {
  env: Env;
  headers: Headers;
  deps: Dependencies;
};

export const createDependencies = (env: Env): Dependencies => {
  return {
    crm: getCrmAdapter(env),
    tickets: createTicketRepository(env.DB),
    calls: createCallRepository(env.DB),
    model: getModelAdapter(env),
  };
};

export const createContext = (env: Env, headers: Headers): RequestContext => {
  const validatedEnv = envSchema.parse(env);
  return {
    env: validatedEnv,
    headers,
    deps: createDependencies(validatedEnv),
  };
};

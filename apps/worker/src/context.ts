import type { CrmAdapter } from "@pestcall/core";

import { getAgentConfig } from "./agents/config";
import { getCrmAdapter } from "./crm";
import { type Env, envSchema } from "./env";
import { getModelAdapter } from "./models";
import {
  createAppointmentRepository,
  createCallRepository,
  createTicketRepository,
} from "./repositories";

export type Dependencies = {
  crm: CrmAdapter;
  tickets: ReturnType<typeof createTicketRepository>;
  calls: ReturnType<typeof createCallRepository>;
  model: ReturnType<typeof getModelAdapter>;
  agentConfig: ReturnType<typeof getAgentConfig>;
  appointments: ReturnType<typeof createAppointmentRepository>;
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
    appointments: createAppointmentRepository(env.DB),
    model: getModelAdapter(env),
    agentConfig: getAgentConfig(env),
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

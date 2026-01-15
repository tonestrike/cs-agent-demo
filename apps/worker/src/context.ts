import type { CrmAdapter } from "@pestcall/core";

import { getAgentConfig } from "./agents/config";
import { getCrmAdapter } from "./crm";
import { type Env, envSchema } from "./env";
import { getModelAdapter } from "./models";
import {
  createAgentConfigRepository,
  createAppointmentRepository,
  createCallRepository,
  createTicketRepository,
} from "./repositories";

export type Dependencies = {
  crm: CrmAdapter;
  tickets: ReturnType<typeof createTicketRepository>;
  calls: ReturnType<typeof createCallRepository>;
  modelFactory: (
    config: ReturnType<typeof getAgentConfig>,
  ) => ReturnType<typeof getModelAdapter>;
  agentConfigDefaults: ReturnType<typeof getAgentConfig>;
  agentConfig: ReturnType<typeof createAgentConfigRepository>;
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
    modelFactory: (config) => getModelAdapter(env, config),
    agentConfigDefaults: getAgentConfig(env),
    agentConfig: createAgentConfigRepository(env.DB),
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

import type { CrmAdapter } from "@pestcall/core";

import { getAgentConfig } from "./agents/config";
import { getCrmAdapter } from "./crm";
import { type Env, envSchema } from "./env";
import { type Logger, createLogger } from "./logger";
import { getModelAdapter } from "./models";
import {
  createAgentConfigRepository,
  createAppointmentRepository,
  createCallRepository,
  createCustomerRepository,
  createTicketRepository,
} from "./repositories";

export type Dependencies = {
  crm: CrmAdapter;
  tickets: ReturnType<typeof createTicketRepository>;
  calls: ReturnType<typeof createCallRepository>;
  customers: ReturnType<typeof createCustomerRepository>;
  modelFactory: (
    config: ReturnType<typeof getAgentConfig>,
  ) => ReturnType<typeof getModelAdapter>;
  agentConfigDefaults: ReturnType<typeof getAgentConfig>;
  agentConfig: ReturnType<typeof createAgentConfigRepository>;
  appointments: ReturnType<typeof createAppointmentRepository>;
  workflows: {
    reschedule?: Workflow;
    verify?: Workflow;
    cancel?: Workflow;
  };
  logger: Logger;
};

export type RequestContext = {
  env: Env;
  headers: Headers;
  deps: Dependencies;
};

export const createDependencies = (env: Env): Dependencies => {
  const logger = createLogger(env);
  return {
    crm: getCrmAdapter(env),
    tickets: createTicketRepository(env.DB),
    calls: createCallRepository(env.DB),
    customers: createCustomerRepository(env.DB),
    appointments: createAppointmentRepository(env.DB),
    workflows: {
      reschedule: env.RESCHEDULE_WORKFLOW,
      verify: env.VERIFY_WORKFLOW,
      cancel: env.CANCEL_WORKFLOW,
    },
    modelFactory: (config) => getModelAdapter(env, config, logger),
    agentConfigDefaults: getAgentConfig(env),
    agentConfig: createAgentConfigRepository(env.DB),
    logger,
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

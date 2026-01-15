import type { CrmAdapter } from "@pestcall/core";

import { getCrmAdapter } from "./crm";
import type { Env } from "./env";
import {
  createCallRepository,
  createTicketRepository,
  type CallRepository,
  type TicketRepository,
} from "./repositories";

export type Dependencies = {
  crm: CrmAdapter;
  tickets: TicketRepository;
  calls: CallRepository;
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
  };
};

export const createContext = (env: Env, headers: Headers): RequestContext => {
  return {
    env,
    headers,
    deps: createDependencies(env),
  };
};

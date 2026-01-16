import type { Client } from "@orpc/client";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type {
  AgentPromptConfigRecord,
  AgentPromptConfigUpdate,
  CallDetail,
  CallIdInput,
  CallListInput,
  CallListOutput,
  ServiceAppointment,
  ServiceAppointmentIdInput,
  ServiceAppointmentListInput,
  ServiceAppointmentListOutput,
  Ticket,
  TicketIdInput,
  TicketListInput,
  TicketListOutput,
} from "@pestcall/core";

import { apiBaseUrl, demoAuthToken } from "./env";

type RpcContext = Record<never, never>;

type RpcClient = {
  calls: {
    list: Client<RpcContext, CallListInput, CallListOutput, unknown>;
    get: Client<RpcContext, CallIdInput, CallDetail, unknown>;
  };
  tickets: {
    list: Client<RpcContext, TicketListInput, TicketListOutput, unknown>;
    get: Client<RpcContext, TicketIdInput, Ticket, unknown>;
  };
  appointments: {
    list: Client<
      RpcContext,
      ServiceAppointmentListInput,
      ServiceAppointmentListOutput,
      unknown
    >;
    get: Client<
      RpcContext,
      ServiceAppointmentIdInput,
      ServiceAppointment,
      unknown
    >;
  };
  agentConfig: {
    get: Client<RpcContext, undefined, AgentPromptConfigRecord, unknown>;
    update: Client<
      RpcContext,
      AgentPromptConfigUpdate,
      AgentPromptConfigRecord,
      unknown
    >;
  };
};

const rpcLink = new RPCLink<RpcContext>({
  url: () => new URL("/rpc", apiBaseUrl).toString(),
  headers: () => {
    const headers: Record<string, string> = {};
    if (demoAuthToken) {
      headers["x-demo-auth"] = demoAuthToken;
    }
    return headers;
  },
});

export const rpcClient = createORPCClient<RpcClient>(rpcLink);

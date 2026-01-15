import { AgentClient } from "agents/client";

import { apiBaseUrl, demoAuthToken } from "./env";

const getAgentHost = () => {
  const resolved =
    apiBaseUrl || (typeof window !== "undefined" ? window.location.origin : "");
  if (!resolved) {
    return null;
  }
  const url = new URL(resolved);
  const protocol: "ws" | "wss" = url.protocol === "https:" ? "wss" : "ws";
  return {
    host: url.host,
    protocol,
  };
};

export const createAgentClient = (sessionId: string) => {
  const endpoint = getAgentHost();
  if (!endpoint) {
    throw new Error("Missing API base URL for agent connection.");
  }

  return new AgentClient({
    agent: "PestCallAgent",
    name: sessionId,
    host: endpoint.host,
    protocol: endpoint.protocol,
    query: demoAuthToken ? { token: demoAuthToken } : undefined,
  });
};

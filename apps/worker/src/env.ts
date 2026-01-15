export type CrmProvider = "mock" | "http";

export type Env = {
  DB: D1Database;
  DEMO_AUTH_TOKEN?: string;
  LOG_LEVEL?: string;
  CRM_PROVIDER?: CrmProvider;
  CRM_BASE_URL?: string;
  CRM_API_KEY?: string;
};

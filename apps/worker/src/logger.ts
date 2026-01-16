import pino from "pino";

export type Logger = pino.Logger;

export const createLogger = (env: { LOG_LEVEL?: string }) => {
  return pino({
    level: env.LOG_LEVEL ?? "info",
    base: { service: "pestcall-worker" },
    redact: {
      paths: ["phoneNumber", "phoneE164", "zipCode", "customerId"],
      remove: true,
    },
  });
};

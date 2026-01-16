import pino from "pino";

export type Logger = pino.Logger;

export const createLogger = (env: {
  LOG_LEVEL?: string;
  BUILD_ID?: string;
}) => {
  return pino({
    level: env.LOG_LEVEL ?? "info",
    base: {
      service: "pestcall-worker",
      build: "BUILD_ID" in env ? (env.BUILD_ID ?? null) : null,
    },
    redact: {
      paths: ["phoneNumber", "phoneE164", "zipCode", "customerId"],
      remove: true,
    },
  });
};

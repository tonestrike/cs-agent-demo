import pino from "pino";

const baseLogger = pino({
  name: "web",
  browser: { asObject: true },
  level: process.env.NEXT_PUBLIC_LOG_LEVEL ?? "info",
});

export const getLogger = (
  component?: string,
  bindings?: Record<string, unknown>,
) =>
  component || bindings
    ? baseLogger.child({ ...(bindings ?? {}), ...(component ? { component } : {}) })
    : baseLogger;

export const logger = baseLogger;

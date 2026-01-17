import pino from "pino";

const baseLogger = pino({
  name: "web",
  browser: { asObject: true },
  level: process.env.NEXT_PUBLIC_LOG_LEVEL ?? "info",
});

export const getLogger = (
  component?: string,
  bindings?: Record<string, unknown>,
) => {
  if (!component && !bindings) {
    return baseLogger;
  }
  const payload = { ...(bindings ?? {}) };
  if (component) {
    payload.component = component;
  }
  return baseLogger.child(payload);
};

export const logger = baseLogger;

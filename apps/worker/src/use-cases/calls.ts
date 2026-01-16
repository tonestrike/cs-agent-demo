import type { Logger } from "../logger";
import type { createCallRepository } from "../repositories";

export const listCalls = (
  repo: ReturnType<typeof createCallRepository>,
  params: {
    limit?: number;
    cursor?: string;
    phoneE164?: string;
    customerCacheId?: string;
  },
) => repo.list(params);

export const getCallDetail = (
  repo: ReturnType<typeof createCallRepository>,
  callSessionId: string,
) => {
  return repo.get(callSessionId);
};

const parseSummary = (summary: string | null, logger: Logger) => {
  if (!summary) {
    return null;
  }
  try {
    const parsed = JSON.parse(summary);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "unknown" },
      "calls.summary.parse_failed",
    );
  }
  return null;
};

export const getCallContext = async (
  repo: ReturnType<typeof createCallRepository>,
  logger: Logger,
  callSessionId: string,
) => {
  const session = await repo.getSession(callSessionId);
  if (!session) {
    return { session: null, summary: null, lastAgentTurn: null };
  }
  const lastAgentTurn = await repo.getLatestAgentTurn(callSessionId);
  return {
    session,
    summary: parseSummary(session.summary ?? null, logger),
    lastAgentTurn,
  };
};

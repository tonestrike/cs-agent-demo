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

const parseSummary = (summary: string | null) => {
  if (!summary) {
    return null;
  }
  try {
    const parsed = JSON.parse(summary);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
};

export const getCallContext = async (
  repo: ReturnType<typeof createCallRepository>,
  callSessionId: string,
) => {
  const session = await repo.getSession(callSessionId);
  if (!session) {
    return { session: null, summary: null, lastAgentTurn: null };
  }
  const lastAgentTurn = await repo.getLatestAgentTurn(callSessionId);
  return {
    session,
    summary: parseSummary(session.summary ?? null),
    lastAgentTurn,
  };
};

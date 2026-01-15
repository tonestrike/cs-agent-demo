import type { createCallRepository } from "../repositories";

export const listCalls = (
  repo: ReturnType<typeof createCallRepository>,
  params: { limit?: number; cursor?: string },
) => repo.list(params);

export const getCallDetail = (
  repo: ReturnType<typeof createCallRepository>,
  callSessionId: string,
) => {
  return repo.get(callSessionId);
};

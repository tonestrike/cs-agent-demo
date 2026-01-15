import type { CallRepository } from "../repositories";

export const listCalls = (
  repo: CallRepository,
  params: { limit?: number; cursor?: string },
) => repo.list(params);

export const getCallDetail = (repo: CallRepository, callSessionId: string) => {
  return repo.get(callSessionId);
};

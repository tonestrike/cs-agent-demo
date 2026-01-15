import type { Ticket, TicketEvent, TicketStatus } from "@pestcall/core";

export type ListResult<T> = {
  items: T[];
  nextCursor: string | null;
};

export type TicketListParams = {
  status?: TicketStatus;
  q?: string;
  limit?: number;
  cursor?: string;
};

export type TicketRepository = {
  list: (params: TicketListParams) => Promise<ListResult<Ticket>>;
  get: (ticketId: string) => Promise<Ticket | null>;
  insert: (ticket: Ticket) => Promise<void>;
  addEvent: (input: {
    ticketId: string;
    type: TicketEvent["type"];
    payload: Record<string, unknown>;
    timestamp: string;
  }) => Promise<TicketEvent>;
  updateStatus: (input: {
    ticketId: string;
    status: TicketStatus;
    updatedAt: string;
  }) => Promise<void>;
};

export type CallSession = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  phoneE164: string;
  customerCacheId: string | null;
  status: string;
  transport: string;
  summary: string | null;
};

export type CallTurn = {
  id: string;
  callSessionId: string;
  ts: string;
  speaker: string;
  text: string;
  meta: Record<string, unknown>;
};

export type CallDetail = {
  session: CallSession;
  turns: CallTurn[];
};

export type CallRepository = {
  list: (params: { limit?: number; cursor?: string }) => Promise<
    ListResult<CallSession>
  >;
  get: (callSessionId: string) => Promise<CallDetail | null>;
};

export type ChatMessage = {
  id: string;
  role: "customer" | "agent" | "status";
  text: string;
};

export type ClientLog = {
  id: string;
  ts: string;
  message: string;
  data?: Record<string, unknown>;
  level?: "info" | "warn" | "error";
  source?: string;
};

export type TurnMetric = {
  turnId: number;
  sessionId: string;
  userText: string;
  userTextLength: number;
  startedAt: number;
  firstTokenAt: number | null;
  firstStatusAt: number | null;
  finalAt: number | null;
  firstTokenMs: number | null;
  firstStatusMs: number | null;
  totalMs: number | null;
  statusTexts: string[];
};

export type Customer = {
  id: string;
  phoneE164: string;
  displayName: string;
  zipCode: string | null;
  addressSummary: string | null;
  participantId?: string | null;
};

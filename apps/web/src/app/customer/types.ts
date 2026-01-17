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
};

export type Customer = {
  id: string;
  phoneE164: string;
  displayName: string;
  zipCode: string | null;
  addressSummary: string | null;
  participantId?: string | null;
};

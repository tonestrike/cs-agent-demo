/**
 * Shared types for conversation session modules
 */

type ConversationEventType =
  | "token"
  | "status"
  | "final"
  | "error"
  | "resync"
  | "speaking";

export type ConversationEvent = {
  id: number;
  seq: number;
  type: ConversationEventType;
  text?: string;
  data?: unknown;
  turnId?: number | null;
  messageId?: string | null;
  role?: "assistant" | "system";
  correlationId?: string;
  at: string;
};

export type SessionState = {
  lastPhoneNumber?: string;
  lastCallSessionId?: string;
  conversation?: import("../../conversation/state-machine").ConversationState;
  cancelWorkflowId?: string;
  rescheduleWorkflowId?: string;
  availableSlots?: Array<{ id: string; date: string; timeWindow: string }>;
  rtkGuestParticipantId?: string;
  rtkGuestCustomId?: string;
  rtkCallSessionId?: string;
  rtkMeetingId?: string;
  pendingIntent?: {
    kind:
      | "appointments"
      | "cancel"
      | "reschedule"
      | "schedule"
      | "billing"
      | "payment"
      | "policy"
      | "escalate";
    text: string;
  };
  /** Active selection state - tracks which selection type we're waiting for */
  activeSelection?: {
    kind: "appointment" | "slot" | "confirmation";
    options: Array<{ id: string; label: string }>;
    presentedAt: number;
    workflowType: "cancel" | "reschedule";
  };
};

export type ClientMessage =
  | { type: "barge_in" }
  | { type: "resync"; lastEventId?: number }
  | { type: "confirm_cancel"; confirmed: boolean; callSessionId?: string }
  | {
      type: "start_cancel";
      customerId?: string;
      callSessionId?: string;
      message?: string;
    }
  | {
      type: "final_transcript" | "message";
      text?: string;
      phoneNumber?: string;
      callSessionId?: string;
    };

/** Appointment data structure used in selections */
export type AppointmentData = {
  id: string;
  date: string;
  timeWindow: string;
  addressSummary: string;
};

/** Slot data structure used in scheduling */
export type SlotData = {
  id: string;
  date: string;
  timeWindow: string;
};

/** Invoice data structure */
export type InvoiceData = {
  id: string;
  balanceCents: number;
  balance?: string;
  currency?: string;
  dueDate: string;
  status: "open" | "paid" | "overdue";
};

/** Session data for summary formatting */
export type SessionData = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  phoneE164: string;
  status: string;
  transport: string;
  summary: string | null;
  callSummary: string | null;
  customer?: {
    id: string;
    displayName: string;
    phoneE164: string;
    addressSummary: string | null;
    zipCode?: string | null;
  };
};

/** Turn data for summary formatting */
export type TurnData = {
  id: string;
  ts: string;
  speaker: string;
  text: string;
  meta?: Record<string, unknown>;
};

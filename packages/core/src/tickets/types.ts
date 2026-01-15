export type TicketStatus = "open" | "in_progress" | "resolved";

export type TicketPriority = "low" | "normal" | "high" | "urgent";

export type TicketCategory =
  | "appointment"
  | "billing"
  | "service"
  | "general"
  | "unknown";

export type TicketSource = "agent" | "phone" | "web" | "internal";

export type Ticket = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  customerCacheId?: string;
  phoneE164?: string;
  subject: string;
  description: string;
  assignee?: string;
  source: TicketSource;
  externalRef?: string;
};

export type TicketEventType =
  | "created"
  | "status_changed"
  | "note_added"
  | "assignment_changed"
  | "follow_up_required";

export type TicketEvent = {
  id: string;
  ticketId: string;
  ts: string;
  type: TicketEventType;
  payload: Record<string, unknown>;
};

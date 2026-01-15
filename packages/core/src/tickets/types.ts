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

export enum TicketEventType {
  Created = "created",
  StatusChanged = "status_changed",
  NoteAdded = "note_added",
  AssignmentChanged = "assignment_changed",
  FollowUpRequired = "follow_up_required",
}

export type TicketEventTypeValue = `${TicketEventType}`;

export type TicketEvent = {
  id: string;
  ticketId: string;
  ts: string;
  type: TicketEventTypeValue;
  payload: Record<string, unknown>;
};

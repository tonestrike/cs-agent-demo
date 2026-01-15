import type {
  Ticket,
  TicketCategory,
  TicketPriority,
  TicketSource,
} from "./types";

export type CreateTicketInput = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  status?: "open" | "in_progress" | "resolved";
  priority?: TicketPriority;
  category?: TicketCategory;
  customerCacheId?: string;
  phoneE164?: string;
  subject: string;
  description: string;
  assignee?: string;
  source: TicketSource;
  externalRef?: string;
};

export const createTicket = (input: CreateTicketInput): Ticket => {
  return {
    id: input.id,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
    status: input.status ?? "open",
    priority: input.priority ?? "normal",
    category: input.category ?? "unknown",
    customerCacheId: input.customerCacheId,
    phoneE164: input.phoneE164,
    subject: input.subject,
    description: input.description,
    assignee: input.assignee,
    source: input.source,
    externalRef: input.externalRef,
  };
};

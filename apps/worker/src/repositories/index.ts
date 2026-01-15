import { createCallRepository } from "./calls";
import { createTicketRepository } from "./tickets";

export { createCallRepository, createTicketRepository };

export type TicketRepository = ReturnType<typeof createTicketRepository>;
export type CallRepository = ReturnType<typeof createCallRepository>;

import { callProcedures } from "./routes/calls";
import { crmProcedures } from "./routes/crm";
import { ticketProcedures } from "./routes/tickets";

export const router = {
  tickets: ticketProcedures,
  calls: callProcedures,
  crm: crmProcedures,
};

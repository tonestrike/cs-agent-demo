import { agentProcedures } from "./routes/agent";
import { agentConfigProcedures } from "./routes/agent-config";
import { appointmentProcedures } from "./routes/appointments";
import { callProcedures } from "./routes/calls";
import { crmProcedures } from "./routes/crm";
import { customerProcedures } from "./routes/customers";
import { ticketProcedures } from "./routes/tickets";

export const router = {
  agentConfig: agentConfigProcedures,
  tickets: ticketProcedures,
  calls: callProcedures,
  appointments: appointmentProcedures,
  crm: crmProcedures,
  customers: customerProcedures,
  agent: agentProcedures,
};

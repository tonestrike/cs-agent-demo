import { agentProcedures } from "./routes/agent";
import { agentConfigProcedures } from "./routes/agent-config";
import { appointmentProcedures } from "./routes/appointments";
import { adminProcedures } from "./routes/admin";
import { callProcedures } from "./routes/calls";
import { crmProcedures } from "./routes/crm";
import { customerProcedures } from "./routes/customers";
import { ticketProcedures } from "./routes/tickets";
import { workflowProcedures } from "./routes/workflows";

export const router = {
  admin: adminProcedures,
  agentConfig: agentConfigProcedures,
  tickets: ticketProcedures,
  calls: callProcedures,
  appointments: appointmentProcedures,
  crm: crmProcedures,
  customers: customerProcedures,
  agent: agentProcedures,
  workflows: workflowProcedures,
};

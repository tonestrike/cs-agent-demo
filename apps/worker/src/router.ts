import { adminProcedures } from "./routes/admin";
import { agentConfigProcedures } from "./routes/agent-config";
import { analyzerProcedures } from "./routes/analyzer";
import { appointmentProcedures } from "./routes/appointments";
import { callProcedures } from "./routes/calls";
import { crmProcedures } from "./routes/crm";
import { customerProcedures } from "./routes/customers";
import { ticketProcedures } from "./routes/tickets";
import { workflowProcedures } from "./routes/workflows";

export const router = {
  admin: adminProcedures,
  agentConfig: agentConfigProcedures,
  analyzer: analyzerProcedures,
  tickets: ticketProcedures,
  calls: callProcedures,
  appointments: appointmentProcedures,
  crm: crmProcedures,
  customers: customerProcedures,
  workflows: workflowProcedures,
};

import { authedProcedure } from "../middleware/auth";
import {
  adminCreateAppointmentInputSchema,
  adminCreateAppointmentOutputSchema,
  adminCreateCustomerInputSchema,
  adminCreateCustomerOutputSchema,
} from "../schemas/admin";
import {
  createAdminAppointment,
  createAdminCustomer,
} from "../use-cases/admin";

export const adminProcedures = {
  createCustomer: authedProcedure
    .input(adminCreateCustomerInputSchema)
    .output(adminCreateCustomerOutputSchema)
    .handler(async ({ input, context }) => {
      return createAdminCustomer(context.deps, input);
    }),
  createAppointment: authedProcedure
    .input(adminCreateAppointmentInputSchema)
    .output(adminCreateAppointmentOutputSchema)
    .handler(async ({ input, context }) => {
      return createAdminAppointment(context.deps, input);
    }),
};

import { authedProcedure } from "../middleware/auth";
import {
  adminCreateAppointmentInputSchema,
  adminCreateAppointmentOutputSchema,
  adminCreateCustomerInputSchema,
  adminCreateCustomerOutputSchema,
  adminGetAppointmentInputSchema,
  adminGetAppointmentOutputSchema,
  adminLookupCustomerInputSchema,
  adminLookupCustomerOutputSchema,
} from "../schemas/admin";
import {
  createAdminAppointment,
  createAdminCustomer,
  getAdminAppointment,
  lookupAdminCustomer,
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
  getAppointment: authedProcedure
    .input(adminGetAppointmentInputSchema)
    .output(adminGetAppointmentOutputSchema)
    .handler(async ({ input, context }) => {
      return getAdminAppointment(context.deps, input);
    }),
  lookupCustomer: authedProcedure
    .input(adminLookupCustomerInputSchema)
    .output(adminLookupCustomerOutputSchema)
    .handler(async ({ input, context }) => {
      return lookupAdminCustomer(context.deps, input);
    }),
};

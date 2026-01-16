import { ORPCError } from "@orpc/server";
import {
  appointmentByIdInputSchema,
  appointmentInputSchema,
  appointmentSchema,
  availableSlotSchema,
  availableSlotsInputSchema,
  createAppointmentInputSchema,
  createNoteInputSchema,
  customerMatchSchema,
  escalateInputSchema,
  escalateResultSchema,
  invoiceSchema,
  invoicesInputSchema,
  listUpcomingAppointmentsInputSchema,
  lookupCustomerByEmailInputSchema,
  lookupCustomerByNameAndZipInputSchema,
  lookupCustomerInputSchema,
  rescheduleInputSchema,
  servicePolicyInputSchema,
  servicePolicyResultSchema,
  verifyAccountInputSchema,
  verifyAccountResultSchema,
} from "@pestcall/core";

import { authedProcedure } from "../middleware/auth";
import {
  createAppointment,
  createNote,
  escalate,
  getAppointmentById,
  getAvailableSlots,
  getNextAppointment,
  getOpenInvoices,
  getServicePolicy,
  listUpcomingAppointments,
  lookupCustomerByEmail,
  lookupCustomerByNameAndZip,
  lookupCustomerByPhone,
  rescheduleAppointment,
  verifyAccount,
} from "../use-cases/crm";

export const crmProcedures = {
  lookupCustomerByPhone: authedProcedure
    .input(lookupCustomerInputSchema)
    .output(customerMatchSchema.array())
    .handler(async ({ input, context }) => {
      return lookupCustomerByPhone(context.deps.crm, input.phoneE164);
    }),
  lookupCustomerByNameAndZip: authedProcedure
    .input(lookupCustomerByNameAndZipInputSchema)
    .output(customerMatchSchema.array())
    .handler(async ({ input, context }) => {
      return lookupCustomerByNameAndZip(
        context.deps.crm,
        input.fullName,
        input.zipCode,
      );
    }),
  lookupCustomerByEmail: authedProcedure
    .input(lookupCustomerByEmailInputSchema)
    .output(customerMatchSchema.array())
    .handler(async ({ input, context }) => {
      return lookupCustomerByEmail(context.deps.crm, input.email);
    }),
  verifyAccount: authedProcedure
    .input(verifyAccountInputSchema)
    .output(verifyAccountResultSchema)
    .handler(async ({ input, context }) => {
      const ok = await verifyAccount(
        context.deps.crm,
        input.customerId,
        input.zipCode,
      );
      return { ok };
    }),
  getNextAppointment: authedProcedure
    .input(appointmentInputSchema)
    .output(appointmentSchema.nullable())
    .handler(async ({ input, context }) => {
      return getNextAppointment(context.deps.crm, input.customerId);
    }),
  listUpcomingAppointments: authedProcedure
    .input(listUpcomingAppointmentsInputSchema)
    .output(appointmentSchema.array())
    .handler(async ({ input, context }) => {
      return listUpcomingAppointments(
        context.deps.crm,
        input.customerId,
        input.limit,
      );
    }),
  getAppointmentById: authedProcedure
    .input(appointmentByIdInputSchema)
    .output(appointmentSchema.nullable())
    .handler(async ({ input, context }) => {
      return getAppointmentById(context.deps.crm, input.appointmentId);
    }),
  getOpenInvoices: authedProcedure
    .input(invoicesInputSchema)
    .output(invoiceSchema.array())
    .handler(async ({ input, context }) => {
      return getOpenInvoices(context.deps.crm, input.customerId);
    }),
  createNote: authedProcedure
    .input(createNoteInputSchema)
    .handler(async ({ input, context }) => {
      await createNote(context.deps.crm, input.customerId, input.note);
      return { ok: true };
    }),
  createAppointment: authedProcedure
    .input(createAppointmentInputSchema)
    .handler(async ({ input, context }) => {
      return createAppointment(context.deps.crm, input);
    }),
  rescheduleAppointment: authedProcedure
    .input(rescheduleInputSchema)
    .handler(async ({ input, context }) => {
      const result = await rescheduleAppointment(
        context.deps.crm,
        input.appointmentId,
        input.slotId,
      );

      if (!result.ok) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Unable to reschedule appointment",
        });
      }

      return result.appointment ?? null;
    }),
  getAvailableSlots: authedProcedure
    .input(availableSlotsInputSchema)
    .output(availableSlotSchema.array())
    .handler(async ({ input, context }) => {
      return getAvailableSlots(context.deps.crm, input.customerId, input);
    }),
  getServicePolicy: authedProcedure
    .input(servicePolicyInputSchema)
    .output(servicePolicyResultSchema)
    .handler(async ({ input, context }) => {
      const text = await getServicePolicy(context.deps.crm, input.topic);
      return { text };
    }),
  escalate: authedProcedure
    .input(escalateInputSchema)
    .output(escalateResultSchema)
    .handler(async ({ input, context }) => {
      return escalate(context.deps.crm, input);
    }),
};

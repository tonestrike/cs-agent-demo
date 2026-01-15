import { ORPCError } from "@orpc/server";
import {
  appointmentInputSchema,
  appointmentSchema,
  availableSlotSchema,
  availableSlotsInputSchema,
  createNoteInputSchema,
  customerMatchSchema,
  invoiceSchema,
  invoicesInputSchema,
  lookupCustomerInputSchema,
  rescheduleInputSchema,
} from "@pestcall/core";

import { authedProcedure } from "../middleware/auth";
import {
  createNote,
  getAvailableSlots,
  getNextAppointment,
  getOpenInvoices,
  lookupCustomerByPhone,
  rescheduleAppointment,
} from "../use-cases/crm";

export const crmProcedures = {
  lookupCustomerByPhone: authedProcedure
    .input(lookupCustomerInputSchema)
    .output(customerMatchSchema.array())
    .handler(async ({ input, context }) => {
      return lookupCustomerByPhone(context.deps.crm, input.phoneE164);
    }),
  getNextAppointment: authedProcedure
    .input(appointmentInputSchema)
    .output(appointmentSchema.nullable())
    .handler(async ({ input, context }) => {
      return getNextAppointment(context.deps.crm, input.customerId);
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
      return getAvailableSlots(
        context.deps.crm,
        input.customerId,
        input.window,
      );
    }),
};

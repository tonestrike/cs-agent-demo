import { ORPCError } from "@orpc/server";
import {
  serviceAppointmentIdInputSchema,
  serviceAppointmentListInputSchema,
  serviceAppointmentListOutputSchema,
  serviceAppointmentSchema,
} from "@pestcall/core";

import { authedProcedure } from "../middleware/auth";
import { getAppointment, listAppointments } from "../use-cases/appointments";

export const appointmentProcedures = {
  list: authedProcedure
    .input(serviceAppointmentListInputSchema)
    .output(serviceAppointmentListOutputSchema)
    .handler(async ({ input, context }) => {
      return listAppointments(context.deps.appointments, input);
    }),
  get: authedProcedure
    .input(serviceAppointmentIdInputSchema)
    .output(serviceAppointmentSchema)
    .handler(async ({ input, context }) => {
      const appointment = await getAppointment(
        context.deps.appointments,
        input.appointmentId,
      );
      if (!appointment) {
        throw new ORPCError("NOT_FOUND", { message: "Appointment not found" });
      }
      return appointment;
    }),
};

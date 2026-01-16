import { ORPCError } from "@orpc/server";
import {
  serviceAppointmentIdInputSchema,
  serviceAppointmentListInputSchema,
  serviceAppointmentListOutputSchema,
  serviceAppointmentSchema,
} from "@pestcall/core";

import { authedProcedure } from "../middleware/auth";
import { getAppointment, listAppointments } from "../use-cases/appointments";

const hydrateAppointments = async (
  deps: {
    customers: {
      list: (input: {
        limit?: number;
      }) => Promise<{
        items: Array<{ id: string; crmCustomerId: string; phoneE164: string }>;
      }>;
      get: (customerId: string) => Promise<{
        id: string;
        crmCustomerId: string;
        phoneE164: string;
      } | null>;
    };
    crm: {
      listUpcomingAppointments: (
        customerId: string,
        limit?: number,
      ) => Promise<
        Array<{
          id: string;
          customerId: string;
          addressSummary: string;
          date: string;
          timeWindow: string;
        }>
      >;
    };
    appointments: {
      upsert: (input: {
        id: string;
        customerId: string;
        phoneE164: string;
        addressSummary: string;
        date: string;
        timeWindow: string;
        status: "scheduled";
        createdAt: string;
        updatedAt: string;
      }) => Promise<void>;
    };
  },
  customerId?: string,
) => {
  const nowIso = new Date().toISOString();
  const customers = customerId
    ? (() => {
        return deps.customers
          .get(customerId)
          .then((customer) => (customer ? [customer] : []));
      })()
    : (() => deps.customers.list({ limit: 50 }).then((res) => res.items))();

  for (const customer of await customers) {
    const appointments = await deps.crm.listUpcomingAppointments(
      customer.crmCustomerId,
      5,
    );
    for (const appointment of appointments) {
      await deps.appointments.upsert({
        id: appointment.id,
        customerId: appointment.customerId,
        phoneE164: customer.phoneE164,
        addressSummary: appointment.addressSummary,
        date: appointment.date,
        timeWindow: appointment.timeWindow,
        status: "scheduled",
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
  }
};

export const appointmentProcedures = {
  list: authedProcedure
    .input(serviceAppointmentListInputSchema)
    .output(serviceAppointmentListOutputSchema)
    .handler(async ({ input, context }) => {
      if (input.refresh) {
        await hydrateAppointments(context.deps, input.customerId);
      }
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

import { ServiceAppointmentStatus } from "@pestcall/core";

import type { Dependencies } from "../context";

export const createAdminCustomer = async (
  deps: Dependencies,
  input: {
    id?: string;
    displayName: string;
    phoneE164: string;
    addressSummary?: string;
    zipCode?: string;
    crmCustomerId?: string;
  },
) => {
  const id = input.id ?? `cust_${crypto.randomUUID()}`;
  await deps.customers.upsert({
    id,
    displayName: input.displayName,
    phoneE164: input.phoneE164,
    addressSummary: input.addressSummary ?? null,
    zipCode: input.zipCode ?? null,
    crmCustomerId: input.crmCustomerId ?? id,
    participantId: null,
    updatedAt: new Date().toISOString(),
  });
  return { id };
};

export const createAdminAppointment = async (
  deps: Dependencies,
  input: {
    id?: string;
    customerId: string;
    phoneE164: string;
    addressSummary: string;
    date: string;
    timeWindow: string;
    status?: ServiceAppointmentStatus;
  },
) => {
  const id = input.id ?? `appt_${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();
  await deps.appointments.upsert({
    id,
    customerId: input.customerId,
    phoneE164: input.phoneE164,
    addressSummary: input.addressSummary,
    date: input.date,
    timeWindow: input.timeWindow,
    status: input.status ?? ServiceAppointmentStatus.Scheduled,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  return { id };
};

export const getAdminAppointment = async (
  deps: Dependencies,
  input: { id: string },
) => {
  const appointment = await deps.appointments.get(input.id);
  if (!appointment) {
    return { appointment: null };
  }
  return {
    appointment: {
      id: appointment.id,
      status: appointment.status,
      date: appointment.date,
      timeWindow: appointment.timeWindow,
      rescheduledFromId: appointment.rescheduledFromId ?? null,
      rescheduledToId: appointment.rescheduledToId ?? null,
    },
  };
};

export const lookupAdminCustomer = async (
  deps: Dependencies,
  input: { phoneE164: string },
) => {
  const customers = await deps.customers.lookupByPhone(input.phoneE164);
  return {
    customers: customers.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      phoneE164: c.phoneE164,
      zipCode: c.zipCode ?? null,
      addressSummary: c.addressSummary ?? null,
    })),
  };
};

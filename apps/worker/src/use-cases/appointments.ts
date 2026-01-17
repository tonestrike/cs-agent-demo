import {
  type ServiceAppointment,
  ServiceAppointmentStatus,
} from "@pestcall/core";

import type { createAppointmentRepository } from "../repositories/appointments";

export const listAppointments = (
  repo: ReturnType<typeof createAppointmentRepository>,
  params: {
    customerId?: string;
    phoneE164?: string;
    limit?: number;
    cursor?: string;
  },
) => repo.list(params);

export const getAppointment = (
  repo: ReturnType<typeof createAppointmentRepository>,
  appointmentId: string,
) => repo.get(appointmentId);

export const rescheduleAppointment = async (
  repo: ReturnType<typeof createAppointmentRepository>,
  input: {
    appointment: ServiceAppointment;
    slot: { date: string; timeWindow: string };
  },
  nowIso = new Date().toISOString(),
) => {
  const nextId = crypto.randomUUID();
  const nextAppointment: ServiceAppointment = {
    id: nextId,
    customerId: input.appointment.customerId,
    phoneE164: input.appointment.phoneE164,
    addressSummary: input.appointment.addressSummary,
    date: input.slot.date,
    timeWindow: input.slot.timeWindow,
    status: ServiceAppointmentStatus.Scheduled,
    rescheduledFromId: input.appointment.id,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await repo.insert(nextAppointment);
  await repo.markRescheduled({
    appointmentId: input.appointment.id,
    rescheduledToId: nextId,
    updatedAt: nowIso,
  });
  await repo.linkReschedule({
    appointmentId: nextId,
    rescheduledFromId: input.appointment.id,
    updatedAt: nowIso,
  });

  return nextAppointment;
};

export const cancelAppointment = async (
  repo: ReturnType<typeof createAppointmentRepository>,
  input: { appointment: ServiceAppointment },
  nowIso = new Date().toISOString(),
) => {
  await repo.markCancelled({
    appointmentId: input.appointment.id,
    updatedAt: nowIso,
  });
  return {
    ...input.appointment,
    status: ServiceAppointmentStatus.Cancelled,
    updatedAt: nowIso,
  };
};

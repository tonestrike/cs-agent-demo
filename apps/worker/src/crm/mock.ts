import type {
  Appointment,
  AvailableSlot,
  CrmAdapter,
  CustomerMatch,
  Invoice,
} from "@pestcall/core";

import {
  appointments as appointmentFixtures,
  availableSlots,
  customers,
  invoices,
} from "./fixtures";

let appointments = [...appointmentFixtures];

const updateAppointment = (appointmentId: string, slotId: string) => {
  const appointmentIndex = appointments.findIndex(
    (appointment) => appointment.id === appointmentId,
  );
  if (appointmentIndex === -1) {
    return null;
  }
  const appointment = appointments[appointmentIndex];
  if (!appointment) {
    return null;
  }
  const slot = availableSlots.find((entry) => entry.id === slotId);
  if (!slot) {
    return null;
  }

  const customer = findCustomerById(appointment.customerId);
  const updated: Appointment = {
    ...appointment,
    date: slot.date,
    timeWindow: slot.timeWindow,
    addressSummary: customer?.addressSummary ?? appointment.addressSummary,
  };

  appointments = [
    ...appointments.slice(0, appointmentIndex),
    updated,
    ...appointments.slice(appointmentIndex + 1),
  ];

  return updated;
};

const findCustomerById = (id: string): CustomerMatch | undefined => {
  return customers.find((customer) => customer.id === id);
};

export const mockCrmAdapter: CrmAdapter = {
  async lookupCustomerByPhone(phoneE164: string): Promise<CustomerMatch[]> {
    return customers.filter((customer) => customer.phoneE164 === phoneE164);
  },
  async getNextAppointment(crmCustomerId: string): Promise<Appointment | null> {
    const appointment = appointments.find(
      (entry) => entry.customerId === crmCustomerId,
    );
    return appointment ?? null;
  },
  async getOpenInvoices(crmCustomerId: string): Promise<Invoice[]> {
    return invoices.filter(
      (invoice) =>
        invoice.customerId === crmCustomerId && invoice.status !== "paid",
    );
  },
  async createNote(_crmCustomerId: string, _note: string): Promise<void> {
    return;
  },
  async rescheduleAppointment(
    appointmentId: string,
    slotId: string,
  ): Promise<{ ok: boolean; appointment?: Appointment }> {
    const updated = updateAppointment(appointmentId, slotId);
    if (!updated) {
      return { ok: false };
    }
    return { ok: true, appointment: updated };
  },
  async getAvailableSlots(
    _crmCustomerId: string,
    _window: { from: string; to: string },
  ): Promise<AvailableSlot[]> {
    return availableSlots;
  },
};

import type {
  Appointment,
  AvailableSlot,
  CrmAdapter,
  CustomerMatch,
  Invoice,
} from "@pestcall/core";

import { appointments, availableSlots, customers, invoices } from "./fixtures";

const findCustomerById = (id: string): CustomerMatch | undefined => {
  return customers.find((customer) => customer.id === id);
};

const findAppointmentById = (id: string): Appointment | undefined => {
  return appointments.find((appointment) => appointment.id === id);
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
    const appointment = findAppointmentById(appointmentId);
    const slot = availableSlots.find((entry) => entry.id === slotId);

    if (!appointment || !slot) {
      return { ok: false };
    }

    const customer = findCustomerById(appointment.customerId);
    const updated: Appointment = {
      ...appointment,
      date: slot.date,
      timeWindow: slot.timeWindow,
      addressSummary: customer?.addressSummary ?? appointment.addressSummary,
    };

    return { ok: true, appointment: updated };
  },
  async getAvailableSlots(
    _crmCustomerId: string,
    _window: { from: string; to: string },
  ): Promise<AvailableSlot[]> {
    return availableSlots;
  },
};

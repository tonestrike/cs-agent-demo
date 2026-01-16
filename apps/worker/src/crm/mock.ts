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
  async lookupCustomerByNameAndZip(
    fullName: string,
    zipCode: string,
  ): Promise<CustomerMatch[]> {
    const lowered = fullName.toLowerCase();
    return customers.filter((customer) => {
      const matchesName = customer.displayName.toLowerCase().includes(lowered);
      const matchesZip = customer.zipCode === zipCode;
      return matchesName && matchesZip;
    });
  },
  async lookupCustomerByEmail(email: string): Promise<CustomerMatch[]> {
    const lowered = email.toLowerCase();
    return customers.filter(
      (customer) => customer.email?.toLowerCase() === lowered,
    );
  },
  async verifyAccount(customerId: string, zipCode: string): Promise<boolean> {
    const customer = findCustomerById(customerId);
    return customer?.zipCode === zipCode;
  },
  async getNextAppointment(crmCustomerId: string): Promise<Appointment | null> {
    const appointment = appointments.find(
      (entry) => entry.customerId === crmCustomerId,
    );
    return appointment ?? null;
  },
  async listUpcomingAppointments(
    crmCustomerId: string,
    limit = 5,
  ): Promise<Appointment[]> {
    return appointments
      .filter((entry) => entry.customerId === crmCustomerId)
      .slice(0, limit);
  },
  async getAppointmentById(appointmentId: string): Promise<Appointment | null> {
    const appointment = appointments.find(
      (entry) => entry.id === appointmentId,
    );
    return appointment ?? null;
  },
  async getOpenInvoices(crmCustomerId: string): Promise<Invoice[]> {
    return invoices.filter(
      (invoice) =>
        invoice.customerId === crmCustomerId && invoice.status !== "paid",
    );
  },
  async escalate(): Promise<{ ok: boolean; ticketId?: string }> {
    return { ok: true, ticketId: `ticket_${crypto.randomUUID()}` };
  },
  async getServicePolicy(topic: string): Promise<string> {
    const policyMap: Record<string, string> = {
      pricing:
        "Pricing depends on service type and property size. A specialist will confirm the exact quote.",
      coverage:
        "Standard coverage includes common household pests. Specialty infestations may require additional treatment.",
      guarantee:
        "We offer a 30-day service guarantee. If issues persist, we will follow up at no additional cost.",
      cancellation:
        "Appointments can be canceled or rescheduled up to 24 hours in advance.",
      prep: "Please clear access to treatment areas and keep pets secured during service.",
    };
    return policyMap[topic] ?? "A specialist can provide the latest policy.";
  },
  async createAppointment(input: {
    customerId: string;
    preferredWindow: string;
    notes?: string;
    pestType?: string;
  }): Promise<{ ok: boolean; appointmentId?: string }> {
    const id = `appt_${crypto.randomUUID()}`;
    const customer = findCustomerById(input.customerId);
    const appointment: Appointment = {
      id,
      customerId: input.customerId,
      addressId: customer?.addresses?.[0]?.addressId,
      date: input.preferredWindow,
      timeWindow: "TBD",
      addressSummary: customer?.addressSummary ?? "Unknown",
    };
    appointments = [appointment, ...appointments];
    return { ok: true, appointmentId: id };
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
    _input: {
      daysAhead?: number;
      fromDate?: string;
      toDate?: string;
      preference?: "morning" | "afternoon" | "any";
    },
  ): Promise<AvailableSlot[]> {
    return availableSlots;
  },
};

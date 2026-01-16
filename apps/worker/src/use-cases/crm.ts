import type { CrmAdapter } from "@pestcall/core";

export const lookupCustomerByPhone = (
  adapter: CrmAdapter,
  phoneE164: string,
) => {
  return adapter.lookupCustomerByPhone(phoneE164);
};

export const lookupCustomerByNameAndZip = (
  adapter: CrmAdapter,
  fullName: string,
  zipCode: string,
) => {
  return adapter.lookupCustomerByNameAndZip(fullName, zipCode);
};

export const lookupCustomerByEmail = (adapter: CrmAdapter, email: string) => {
  return adapter.lookupCustomerByEmail(email);
};

export const verifyAccount = (
  adapter: CrmAdapter,
  customerId: string,
  zipCode: string,
) => {
  return adapter.verifyAccount(customerId, zipCode);
};

export const getNextAppointment = (adapter: CrmAdapter, customerId: string) => {
  return adapter.getNextAppointment(customerId);
};

export const listUpcomingAppointments = (
  adapter: CrmAdapter,
  customerId: string,
  limit?: number,
) => {
  return adapter.listUpcomingAppointments(customerId, limit);
};

export const getAppointmentById = (
  adapter: CrmAdapter,
  appointmentId: string,
) => {
  return adapter.getAppointmentById(appointmentId);
};

export const getOpenInvoices = (adapter: CrmAdapter, customerId: string) => {
  return adapter.getOpenInvoices(customerId);
};

export const escalate = (
  adapter: CrmAdapter,
  input: {
    reason: string;
    summary: string;
    customerId?: string;
    appointmentId?: string;
  },
) => {
  return adapter.escalate(input);
};

export const getServicePolicy = (adapter: CrmAdapter, topic: string) => {
  return adapter.getServicePolicy(topic);
};

export const createAppointment = (
  adapter: CrmAdapter,
  input: {
    customerId: string;
    preferredWindow: string;
    notes?: string;
    pestType?: string;
  },
) => {
  return adapter.createAppointment(input);
};

export const createNote = (
  adapter: CrmAdapter,
  customerId: string,
  note: string,
) => {
  return adapter.createNote(customerId, note);
};

export const rescheduleAppointment = (
  adapter: CrmAdapter,
  appointmentId: string,
  slotId: string,
) => {
  return adapter.rescheduleAppointment(appointmentId, slotId);
};

export const getAvailableSlots = (
  adapter: CrmAdapter,
  customerId: string,
  input: {
    daysAhead?: number;
    fromDate?: string;
    toDate?: string;
    preference?: "morning" | "afternoon" | "any";
  },
) => {
  return adapter.getAvailableSlots(customerId, input);
};

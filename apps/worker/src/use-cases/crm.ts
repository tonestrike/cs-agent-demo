import type { CrmAdapter } from "@pestcall/core";

export const lookupCustomerByPhone = (
  adapter: CrmAdapter,
  phoneE164: string,
) => {
  return adapter.lookupCustomerByPhone(phoneE164);
};

export const getNextAppointment = (adapter: CrmAdapter, customerId: string) => {
  return adapter.getNextAppointment(customerId);
};

export const getOpenInvoices = (adapter: CrmAdapter, customerId: string) => {
  return adapter.getOpenInvoices(customerId);
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
  window: { from: string; to: string },
) => {
  return adapter.getAvailableSlots(customerId, window);
};

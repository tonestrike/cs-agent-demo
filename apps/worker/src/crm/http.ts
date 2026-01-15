import type {
  Appointment,
  AvailableSlot,
  CrmAdapter,
  CustomerMatch,
  Invoice,
} from "@pestcall/core";

import type { Env } from "../env";

export const createHttpCrmAdapter = (env: Env): CrmAdapter => {
  const baseUrl = env.CRM_BASE_URL;
  const apiKey = env.CRM_API_KEY;

  const notConfigured = (): never => {
    throw new Error("CRM HTTP adapter not configured");
  };

  return {
    async lookupCustomerByPhone(_phoneE164: string): Promise<CustomerMatch[]> {
      if (!baseUrl || !apiKey) {
        notConfigured();
      }
      return [];
    },
    async getNextAppointment(
      _crmCustomerId: string,
    ): Promise<Appointment | null> {
      if (!baseUrl || !apiKey) {
        notConfigured();
      }
      return null;
    },
    async getOpenInvoices(_crmCustomerId: string): Promise<Invoice[]> {
      if (!baseUrl || !apiKey) {
        notConfigured();
      }
      return [];
    },
    async createNote(_crmCustomerId: string, _note: string): Promise<void> {
      if (!baseUrl || !apiKey) {
        notConfigured();
      }
    },
    async rescheduleAppointment(
      _appointmentId: string,
      _slotId: string,
    ): Promise<{ ok: boolean; appointment?: Appointment }> {
      if (!baseUrl || !apiKey) {
        notConfigured();
      }
      return { ok: false };
    },
    async getAvailableSlots(
      _crmCustomerId: string,
      _window: { from: string; to: string },
    ): Promise<AvailableSlot[]> {
      if (!baseUrl || !apiKey) {
        notConfigured();
      }
      return [];
    },
  };
};

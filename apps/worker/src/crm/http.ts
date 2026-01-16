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
    async lookupCustomerByNameAndZip(
      _fullName: string,
      _zipCode: string,
    ): Promise<CustomerMatch[]> {
      if (!baseUrl || !apiKey) {
        notConfigured();
      }
      return [];
    },
    async lookupCustomerByEmail(_email: string): Promise<CustomerMatch[]> {
      if (!baseUrl || !apiKey) {
        notConfigured();
      }
      return [];
    },
    async verifyAccount(
      _customerId: string,
      _zipCode: string,
    ): Promise<boolean> {
      if (!baseUrl || !apiKey) {
        notConfigured();
      }
      return false;
    },
    async getNextAppointment(
      _crmCustomerId: string,
    ): Promise<Appointment | null> {
      if (!baseUrl || !apiKey) {
        notConfigured();
      }
      return null;
    },
    async listUpcomingAppointments(
      _crmCustomerId: string,
      _limit?: number,
    ): Promise<Appointment[]> {
      if (!baseUrl || !apiKey) {
        notConfigured();
      }
      return [];
    },
    async getAppointmentById(
      _appointmentId: string,
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
    async escalate(_input: {
      reason: string;
      summary: string;
      customerId?: string;
      appointmentId?: string;
    }): Promise<{ ok: boolean; ticketId?: string }> {
      if (!baseUrl || !apiKey) {
        notConfigured();
      }
      return { ok: false };
    },
    async getServicePolicy(_topic: string): Promise<string> {
      if (!baseUrl || !apiKey) {
        notConfigured();
      }
      return "";
    },
    async createAppointment(_input: {
      customerId: string;
      preferredWindow: string;
      notes?: string;
      pestType?: string;
    }): Promise<{ ok: boolean; appointmentId?: string }> {
      if (!baseUrl || !apiKey) {
        notConfigured();
      }
      return { ok: false };
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
      _input: {
        daysAhead?: number;
        fromDate?: string;
        toDate?: string;
        preference?: "morning" | "afternoon" | "any";
      },
    ): Promise<AvailableSlot[]> {
      if (!baseUrl || !apiKey) {
        notConfigured();
      }
      return [];
    },
  };
};

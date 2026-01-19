/**
 * D1 CRM Adapter
 *
 * Uses the D1 database for customer and appointment data instead of mock fixtures.
 * Set CRM_PROVIDER=d1 to use this adapter.
 */

import {
  type Appointment,
  type AvailableSlot,
  type CrmAdapter,
  type CustomerMatch,
  type Invoice,
  ServiceAppointmentStatus,
} from "@pestcall/core";

import { createAppointmentRepository } from "../repositories/appointments";
import { createCustomerRepository } from "../repositories/customers";

/**
 * Generate available slots for the next N days.
 * In a real system, this would check technician availability, service areas, etc.
 */
function generateAvailableSlots(
  daysAhead: number,
  fromDate?: string,
  preference?: "morning" | "afternoon" | "any",
): AvailableSlot[] {
  const slots: AvailableSlot[] = [];
  const startDate = fromDate ? new Date(fromDate) : new Date();

  // Morning and afternoon time windows
  const timeWindows = {
    morning: ["08:00-10:00", "10:00-12:00"],
    afternoon: ["13:00-15:00", "15:00-17:00"],
  };

  for (let i = 0; i < daysAhead; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    const dateStr = date.toISOString().split("T")[0];

    const windows =
      preference === "morning"
        ? timeWindows.morning
        : preference === "afternoon"
          ? timeWindows.afternoon
          : [...timeWindows.morning, ...timeWindows.afternoon];

    for (const timeWindow of windows) {
      slots.push({
        id: `slot_${dateStr}_${timeWindow.replace(":", "").replace("-", "_")}`,
        date: dateStr ?? "",
        timeWindow,
      });
    }
  }

  return slots.slice(0, 10); // Return max 10 slots
}

/**
 * Create a D1-based CRM adapter.
 */
export function createD1CrmAdapter(db: D1Database): CrmAdapter {
  const customers = createCustomerRepository(db);
  const appointments = createAppointmentRepository(db);

  // Cache available slots in memory (would be persisted in real system)
  let cachedSlots: AvailableSlot[] = [];

  return {
    async lookupCustomerByPhone(phoneE164: string): Promise<CustomerMatch[]> {
      return customers.lookupByPhone(phoneE164);
    },

    async lookupCustomerByNameAndZip(
      fullName: string,
      zipCode: string,
    ): Promise<CustomerMatch[]> {
      return customers.lookupByNameAndZip(fullName, zipCode);
    },

    async lookupCustomerByEmail(_email: string): Promise<CustomerMatch[]> {
      // Email lookup not implemented in customers_cache schema
      // Would need to add email column to support this
      return [];
    },

    async verifyAccount(customerId: string, zipCode: string): Promise<boolean> {
      return customers.verifyZip(customerId, zipCode);
    },

    async getNextAppointment(
      crmCustomerId: string,
    ): Promise<Appointment | null> {
      const appointment =
        await appointments.getLatestForCustomer(crmCustomerId);
      if (!appointment) return null;

      return {
        id: appointment.id,
        customerId: appointment.customerId,
        date: appointment.date,
        timeWindow: appointment.timeWindow,
        addressSummary: appointment.addressSummary,
      };
    },

    async listUpcomingAppointments(
      crmCustomerId: string,
      limit = 5,
    ): Promise<Appointment[]> {
      const result = await appointments.list({
        customerId: crmCustomerId,
        limit,
      });

      return result.items
        .filter((apt) => apt.status === ServiceAppointmentStatus.Scheduled)
        .map((apt) => ({
          id: apt.id,
          customerId: apt.customerId,
          date: apt.date,
          timeWindow: apt.timeWindow,
          addressSummary: apt.addressSummary,
        }));
    },

    async getAppointmentById(
      appointmentId: string,
    ): Promise<Appointment | null> {
      const appointment = await appointments.get(appointmentId);
      if (!appointment) return null;

      return {
        id: appointment.id,
        customerId: appointment.customerId,
        date: appointment.date,
        timeWindow: appointment.timeWindow,
        addressSummary: appointment.addressSummary,
      };
    },

    async getOpenInvoices(_crmCustomerId: string): Promise<Invoice[]> {
      // Invoices not implemented in D1 - would need separate table
      return [];
    },

    async escalate(_input: {
      reason: string;
      summary: string;
      customerId?: string;
      appointmentId?: string;
    }): Promise<{ ok: boolean; ticketId?: string }> {
      // Could create a ticket in the tickets table
      const ticketId = `ticket_${crypto.randomUUID()}`;
      // For now, just return success - ticket creation would be separate
      return { ok: true, ticketId };
    },

    async getServicePolicy(topic: string): Promise<string> {
      // Service policies - could be stored in a config table
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
      const customer = await customers.get(input.customerId);
      if (!customer) {
        return { ok: false };
      }

      // Parse the preferred window to extract date and time
      // Expected format: "2025-02-15 10:00-12:00" or similar
      const parts = input.preferredWindow.split(" ");
      const date = parts[0] ?? new Date().toISOString().split("T")[0] ?? "";
      const timeWindow = parts[1] ?? "TBD";

      const now = new Date().toISOString();
      const appointmentId = `appt_${crypto.randomUUID()}`;

      await appointments.insert({
        id: appointmentId,
        customerId: input.customerId,
        phoneE164: customer.phoneE164,
        addressSummary: customer.addressSummary ?? "Unknown",
        date,
        timeWindow,
        status: ServiceAppointmentStatus.Scheduled,
        createdAt: now,
        updatedAt: now,
      });

      return { ok: true, appointmentId };
    },

    async createNote(_crmCustomerId: string, _note: string): Promise<void> {
      // Notes could be stored in a separate table or as ticket events
      return;
    },

    async rescheduleAppointment(
      appointmentId: string,
      slotId: string,
    ): Promise<{ ok: boolean; appointment?: Appointment }> {
      const existing = await appointments.get(appointmentId);
      if (!existing) {
        return { ok: false };
      }

      // Find the slot from cached slots
      const slot = cachedSlots.find((s) => s.id === slotId);
      if (!slot) {
        return { ok: false };
      }

      const now = new Date().toISOString();
      const newAppointmentId = `appt_${crypto.randomUUID()}`;

      // Create new appointment
      await appointments.insert({
        id: newAppointmentId,
        customerId: existing.customerId,
        phoneE164: existing.phoneE164,
        addressSummary: existing.addressSummary,
        date: slot.date,
        timeWindow: slot.timeWindow,
        status: ServiceAppointmentStatus.Scheduled,
        rescheduledFromId: appointmentId,
        createdAt: now,
        updatedAt: now,
      });

      // Mark old appointment as rescheduled
      await appointments.markRescheduled({
        appointmentId,
        rescheduledToId: newAppointmentId,
        updatedAt: now,
      });

      return {
        ok: true,
        appointment: {
          id: newAppointmentId,
          customerId: existing.customerId,
          date: slot.date,
          timeWindow: slot.timeWindow,
          addressSummary: existing.addressSummary,
        },
      };
    },

    async cancelAppointment(
      appointmentId: string,
    ): Promise<{ ok: boolean; appointment?: Appointment }> {
      const existing = await appointments.get(appointmentId);
      if (!existing) {
        return { ok: false };
      }

      const now = new Date().toISOString();
      await appointments.markCancelled({
        appointmentId,
        updatedAt: now,
      });

      return {
        ok: true,
        appointment: {
          id: existing.id,
          customerId: existing.customerId,
          date: existing.date,
          timeWindow: existing.timeWindow,
          addressSummary: existing.addressSummary,
        },
      };
    },

    async getAvailableSlots(
      _crmCustomerId: string,
      input: {
        daysAhead?: number;
        fromDate?: string;
        toDate?: string;
        preference?: "morning" | "afternoon" | "any";
      },
    ): Promise<AvailableSlot[]> {
      // Generate slots based on preferences
      const daysAhead = input.daysAhead ?? 7;
      cachedSlots = generateAvailableSlots(
        daysAhead,
        input.fromDate,
        input.preference,
      );
      return cachedSlots;
    },
  };
}

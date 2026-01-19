import { describe, expect, it } from "vitest";
import {
  formatAppointmentLabel,
  formatAppointmentsResponse,
} from "../formatters/appointment-formatter";
import { formatInvoicesResponse } from "../formatters/invoice-formatter";
import {
  formatAvailableSlotsResponse,
  formatSlotLabel,
} from "../formatters/slot-formatter";

describe("appointment-formatter", () => {
  describe("formatAppointmentLabel", () => {
    it("formats appointment with all fields", () => {
      const result = formatAppointmentLabel({
        date: "2024-01-15",
        timeWindow: "9am-12pm",
        addressSummary: "123 Main St",
      });
      expect(result).toBe("2024-01-15 9am-12pm at 123 Main St");
    });
  });

  describe("formatAppointmentsResponse", () => {
    it("formats single appointment with singular intro", () => {
      const result = formatAppointmentsResponse([
        {
          id: "1",
          date: "2024-01-15",
          timeWindow: "9am-12pm",
          addressSummary: "123 Main St",
        },
      ]);
      expect(result).toBe(
        "Here is your upcoming appointment: 1) 2024-01-15 9am-12pm at 123 Main St",
      );
    });

    it("formats multiple appointments with plural intro", () => {
      const result = formatAppointmentsResponse([
        {
          id: "1",
          date: "2024-01-15",
          timeWindow: "9am-12pm",
          addressSummary: "123 Main St",
        },
        {
          id: "2",
          date: "2024-01-16",
          timeWindow: "1pm-4pm",
          addressSummary: "456 Oak Ave",
        },
      ]);
      expect(result).toBe(
        "Here are your upcoming appointments: 1) 2024-01-15 9am-12pm at 123 Main St 2) 2024-01-16 1pm-4pm at 456 Oak Ave",
      );
    });

    it("returns empty-like response for empty array", () => {
      const result = formatAppointmentsResponse([]);
      expect(result).toBe("Here are your upcoming appointments:");
    });
  });
});

describe("slot-formatter", () => {
  describe("formatSlotLabel", () => {
    it("formats slot with date and time", () => {
      const result = formatSlotLabel({
        date: "2024-01-15",
        timeWindow: "9am-12pm",
      });
      expect(result).toBe("2024-01-15 9am-12pm");
    });
  });

  describe("formatAvailableSlotsResponse", () => {
    it("formats single slot with singular intro", () => {
      const result = formatAvailableSlotsResponse([
        { id: "1", date: "2024-01-15", timeWindow: "9am-12pm" },
      ]);
      expect(result).toBe(
        "Here is the next available time: 1) 2024-01-15 9am-12pm",
      );
    });

    it("formats multiple slots with plural intro", () => {
      const result = formatAvailableSlotsResponse([
        { id: "1", date: "2024-01-15", timeWindow: "9am-12pm" },
        { id: "2", date: "2024-01-16", timeWindow: "1pm-4pm" },
      ]);
      expect(result).toBe(
        "Here are the next available times: 1) 2024-01-15 9am-12pm 2) 2024-01-16 1pm-4pm",
      );
    });

    it("appends prompt when provided", () => {
      const result = formatAvailableSlotsResponse(
        [{ id: "1", date: "2024-01-15", timeWindow: "9am-12pm" }],
        "Which works for you?",
      );
      expect(result).toBe(
        "Here is the next available time: 1) 2024-01-15 9am-12pm Which works for you?",
      );
    });
  });
});

describe("invoice-formatter", () => {
  describe("formatInvoicesResponse", () => {
    it("formats single invoice with singular intro", () => {
      const result = formatInvoicesResponse([
        {
          id: "1",
          balanceCents: 10000,
          dueDate: "2024-02-01",
          status: "open" as const,
        },
      ]);
      expect(result).toBe(
        "Here is your open invoice: 1) $100.00 due 2024-02-01",
      );
    });

    it("formats multiple invoices with plural intro", () => {
      const result = formatInvoicesResponse([
        {
          id: "1",
          balanceCents: 10000,
          dueDate: "2024-02-01",
          status: "open" as const,
        },
        {
          id: "2",
          balanceCents: 5000,
          dueDate: "2024-03-01",
          status: "overdue" as const,
        },
      ]);
      expect(result).toBe(
        "Here are your open invoices: 1) $100.00 due 2024-02-01 2) $50.00 due 2024-03-01 (overdue)",
      );
    });

    it("uses balance string when provided", () => {
      const result = formatInvoicesResponse([
        {
          id: "1",
          balanceCents: 10000,
          balance: "99.99",
          dueDate: "2024-02-01",
          status: "open" as const,
        },
      ]);
      expect(result).toBe(
        "Here is your open invoice: 1) $99.99 due 2024-02-01",
      );
    });

    it("formats non-USD currency", () => {
      const result = formatInvoicesResponse([
        {
          id: "1",
          balanceCents: 10000,
          currency: "EUR",
          dueDate: "2024-02-01",
          status: "open" as const,
        },
      ]);
      expect(result).toBe(
        "Here is your open invoice: 1) 100.00 EUR due 2024-02-01",
      );
    });
  });
});

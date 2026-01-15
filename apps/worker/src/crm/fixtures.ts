import type {
  Appointment,
  AvailableSlot,
  CustomerMatch,
  Invoice,
} from "@pestcall/core";

export const customers: CustomerMatch[] = [
  {
    id: "cust_001",
    displayName: "Alex Rivera",
    phoneE164: "+15551234567",
    addressSummary: "742 Evergreen Terrace",
  },
  {
    id: "cust_002",
    displayName: "Morgan Lee",
    phoneE164: "+15559876543",
    addressSummary: "123 Harbor Drive",
  },
];

export const appointments: Appointment[] = [
  {
    id: "appt_001",
    customerId: "cust_001",
    date: "2025-02-10",
    timeWindow: "10:00-12:00",
    addressSummary: "742 Evergreen Terrace",
  },
  {
    id: "appt_002",
    customerId: "cust_002",
    date: "2025-02-12",
    timeWindow: "14:00-16:00",
    addressSummary: "123 Harbor Drive",
  },
];

export const invoices: Invoice[] = [
  {
    id: "inv_001",
    customerId: "cust_001",
    balanceCents: 12900,
    dueDate: "2025-02-15",
    status: "open",
  },
  {
    id: "inv_002",
    customerId: "cust_002",
    balanceCents: 0,
    dueDate: "2025-01-15",
    status: "paid",
  },
];

export const availableSlots: AvailableSlot[] = [
  {
    id: "slot_001",
    date: "2025-02-14",
    timeWindow: "09:00-11:00",
  },
  {
    id: "slot_002",
    date: "2025-02-15",
    timeWindow: "13:00-15:00",
  },
];

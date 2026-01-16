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
    phoneE164: "+14155552671",
    addressSummary: "742 Evergreen Terrace",
    zipCode: "94107",
    email: "alex.rivera@example.com",
    addresses: [
      {
        addressId: "addr_001",
        addressSummary: "742 Evergreen Terrace",
        zipCode: "94107",
      },
    ],
  },
  {
    id: "cust_002",
    displayName: "Morgan Lee",
    phoneE164: "+14155550987",
    addressSummary: "123 Harbor Drive",
    zipCode: "98109",
    email: "morgan.lee@example.com",
    addresses: [
      {
        addressId: "addr_002",
        addressSummary: "123 Harbor Drive",
        zipCode: "98109",
      },
    ],
  },
  {
    id: "cust_003",
    displayName: "Pat Quinn",
    phoneE164: "+14155551234",
    addressSummary: "88 Market Street",
    zipCode: "60601",
    email: "pat.quinn@example.com",
    addresses: [
      {
        addressId: "addr_003",
        addressSummary: "88 Market Street",
        zipCode: "60601",
      },
    ],
  },
  {
    id: "cust_004",
    displayName: "Riley Hart",
    phoneE164: "+14155551234",
    addressSummary: "55 Pine Avenue",
    zipCode: "60602",
    email: "riley.hart@example.com",
    addresses: [
      {
        addressId: "addr_004",
        addressSummary: "55 Pine Avenue",
        zipCode: "60602",
      },
    ],
  },
];

export const appointments: Appointment[] = [
  {
    id: "appt_001",
    customerId: "cust_001",
    addressId: "addr_001",
    date: "2025-02-10",
    timeWindow: "10:00-12:00",
    addressSummary: "742 Evergreen Terrace",
  },
  {
    id: "appt_002",
    customerId: "cust_002",
    addressId: "addr_002",
    date: "2025-02-12",
    timeWindow: "14:00-16:00",
    addressSummary: "123 Harbor Drive",
  },
  {
    id: "appt_005",
    customerId: "cust_002",
    addressId: "addr_002",
    date: "2025-03-05",
    timeWindow: "09:00-11:00",
    addressSummary: "123 Harbor Drive",
  },
  {
    id: "appt_003",
    customerId: "cust_003",
    addressId: "addr_003",
    date: "2025-02-18",
    timeWindow: "08:00-10:00",
    addressSummary: "88 Market Street",
  },
  {
    id: "appt_004",
    customerId: "cust_004",
    addressId: "addr_004",
    date: "2025-02-19",
    timeWindow: "15:00-17:00",
    addressSummary: "55 Pine Avenue",
  },
];

export const invoices: Invoice[] = [
  {
    id: "inv_001",
    customerId: "cust_001",
    balanceCents: 12900,
    balance: "129.00",
    currency: "USD",
    dueDate: "2025-02-15",
    status: "open",
  },
  {
    id: "inv_002",
    customerId: "cust_002",
    balanceCents: 0,
    balance: "0.00",
    currency: "USD",
    dueDate: "2025-01-15",
    status: "paid",
  },
  {
    id: "inv_003",
    customerId: "cust_003",
    balanceCents: 4500,
    balance: "45.00",
    currency: "USD",
    dueDate: "2025-02-20",
    status: "open",
  },
  {
    id: "inv_004",
    customerId: "cust_004",
    balanceCents: 9900,
    balance: "99.00",
    currency: "USD",
    dueDate: "2025-02-22",
    status: "open",
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

import { z } from "zod";

export const phoneE164Schema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Invalid E.164 phone number");

export const customerMatchSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  phoneE164: phoneE164Schema,
  addressSummary: z.string(),
});

export type CustomerMatch = z.infer<typeof customerMatchSchema>;

export const appointmentSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  date: z.string(),
  timeWindow: z.string(),
  addressSummary: z.string(),
});

export type Appointment = z.infer<typeof appointmentSchema>;

export const invoiceSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  balanceCents: z.number().int().nonnegative(),
  dueDate: z.string(),
  status: z.enum(["open", "paid", "overdue"]),
});

export type Invoice = z.infer<typeof invoiceSchema>;

export const availableSlotSchema = z.object({
  id: z.string(),
  date: z.string(),
  timeWindow: z.string(),
});

export type AvailableSlot = z.infer<typeof availableSlotSchema>;

export const lookupCustomerInputSchema = z.object({
  phoneE164: phoneE164Schema,
});

export const appointmentInputSchema = z.object({
  customerId: z.string(),
});

export const invoicesInputSchema = z.object({
  customerId: z.string(),
});

export const createNoteInputSchema = z.object({
  customerId: z.string(),
  note: z.string().min(1),
});

export const rescheduleInputSchema = z.object({
  appointmentId: z.string(),
  slotId: z.string(),
});

export const availableSlotsInputSchema = z.object({
  customerId: z.string(),
  window: z.object({
    from: z.string(),
    to: z.string(),
  }),
});

export type CrmAdapter = {
  lookupCustomerByPhone: (phoneE164: string) => Promise<CustomerMatch[]>;
  getNextAppointment: (crmCustomerId: string) => Promise<Appointment | null>;
  getOpenInvoices: (crmCustomerId: string) => Promise<Invoice[]>;
  createNote: (crmCustomerId: string, note: string) => Promise<void>;
  rescheduleAppointment: (
    appointmentId: string,
    slotId: string,
  ) => Promise<{ ok: boolean; appointment?: Appointment }>;
  getAvailableSlots: (
    crmCustomerId: string,
    window: { from: string; to: string },
  ) => Promise<AvailableSlot[]>;
};

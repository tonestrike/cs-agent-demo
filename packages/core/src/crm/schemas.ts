import { z } from "zod";

export const phoneE164Schema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Invalid E.164 phone number");

export const customerMatchSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  phoneE164: phoneE164Schema,
  addressSummary: z.string(),
  zipCode: z
    .string()
    .regex(/^\d{5}$/)
    .optional(),
  email: z.string().email().optional(),
  addresses: z
    .array(
      z.object({
        addressId: z.string(),
        addressSummary: z.string(),
        zipCode: z.string().regex(/^\d{5}$/),
      }),
    )
    .optional(),
});

export type CustomerMatch = z.infer<typeof customerMatchSchema>;

export const appointmentSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  addressId: z.string().optional(),
  date: z.string(),
  timeWindow: z.string(),
  addressSummary: z.string(),
});

export type Appointment = z.infer<typeof appointmentSchema>;

export const invoiceSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  balanceCents: z.number().int().nonnegative(),
  balance: z
    .string()
    .regex(/^\d+\.\d{2}$/)
    .optional(),
  currency: z.string().min(1).optional(),
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

export const lookupCustomerByPhoneInputSchema = z.object({
  phoneE164: phoneE164Schema,
});

export const lookupCustomerInputSchema = lookupCustomerByPhoneInputSchema;

export const lookupCustomerByNameAndZipInputSchema = z.object({
  fullName: z.string().min(1),
  zipCode: z.string().regex(/^\d{5}$/),
});

export const lookupCustomerByEmailInputSchema = z.object({
  email: z.string().email(),
});

export const verifyAccountInputSchema = z.object({
  customerId: z.string(),
  zipCode: z.string().regex(/^\d{5}$/),
});

export const verifyAccountResultSchema = z.object({
  ok: z.boolean(),
});

export const appointmentInputSchema = z.object({
  customerId: z.string(),
});

export const appointmentByIdInputSchema = z.object({
  appointmentId: z.string(),
});

export const listUpcomingAppointmentsInputSchema = z.object({
  customerId: z.string(),
  limit: z.number().int().positive().optional(),
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
  daysAhead: z.number().int().positive().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  preference: z.enum(["morning", "afternoon", "any"]).optional(),
});

export const escalateInputSchema = z.object({
  reason: z.string().min(1),
  summary: z.string().min(1),
  customerId: z.string().optional(),
  appointmentId: z.string().optional(),
});

export const escalateResultSchema = z.object({
  ok: z.boolean(),
  ticketId: z.string().optional(),
});

export const servicePolicyTopicSchema = z.enum([
  "pricing",
  "coverage",
  "guarantee",
  "cancellation",
  "prep",
]);

export const servicePolicyInputSchema = z.object({
  topic: servicePolicyTopicSchema,
});

export const servicePolicyResultSchema = z.object({
  text: z.string().min(1),
});

export const createAppointmentInputSchema = z.object({
  customerId: z.string(),
  preferredWindow: z.string().min(1),
  notes: z.string().optional(),
  pestType: z.string().optional(),
});

export const createAppointmentResultSchema = z.object({
  ok: z.boolean(),
  appointmentId: z.string().optional(),
});

export type CrmAdapter = {
  lookupCustomerByPhone: (phoneE164: string) => Promise<CustomerMatch[]>;
  lookupCustomerByNameAndZip: (
    fullName: string,
    zipCode: string,
  ) => Promise<CustomerMatch[]>;
  lookupCustomerByEmail: (email: string) => Promise<CustomerMatch[]>;
  verifyAccount: (customerId: string, zipCode: string) => Promise<boolean>;
  getNextAppointment: (crmCustomerId: string) => Promise<Appointment | null>;
  listUpcomingAppointments: (
    crmCustomerId: string,
    limit?: number,
  ) => Promise<Appointment[]>;
  getAppointmentById: (appointmentId: string) => Promise<Appointment | null>;
  getOpenInvoices: (crmCustomerId: string) => Promise<Invoice[]>;
  escalate: (input: {
    reason: string;
    summary: string;
    customerId?: string;
    appointmentId?: string;
  }) => Promise<{ ok: boolean; ticketId?: string }>;
  getServicePolicy: (topic: string) => Promise<string>;
  createAppointment: (input: {
    customerId: string;
    preferredWindow: string;
    notes?: string;
    pestType?: string;
  }) => Promise<{ ok: boolean; appointmentId?: string }>;
  createNote: (crmCustomerId: string, note: string) => Promise<void>;
  rescheduleAppointment: (
    appointmentId: string,
    slotId: string,
  ) => Promise<{ ok: boolean; appointment?: Appointment }>;
  getAvailableSlots: (
    crmCustomerId: string,
    input: {
      daysAhead?: number;
      fromDate?: string;
      toDate?: string;
      preference?: "morning" | "afternoon" | "any";
    },
  ) => Promise<AvailableSlot[]>;
};

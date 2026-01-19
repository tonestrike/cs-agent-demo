import { ServiceAppointmentStatus } from "@pestcall/core";
import { z } from "zod";

export const adminCreateCustomerInputSchema = z.object({
  id: z.string().min(1).optional(),
  displayName: z.string().min(1),
  phoneE164: z.string().min(1),
  addressSummary: z.string().min(1).optional(),
  zipCode: z.string().min(1).optional(),
  crmCustomerId: z.string().min(1).optional(),
});

export const adminCreateCustomerOutputSchema = z.object({
  id: z.string().min(1),
});

export const adminCreateAppointmentInputSchema = z.object({
  id: z.string().min(1).optional(),
  customerId: z.string().min(1),
  phoneE164: z.string().min(1),
  addressSummary: z.string().min(1),
  date: z.string().min(1),
  timeWindow: z.string().min(1),
  status: z.nativeEnum(ServiceAppointmentStatus).optional(),
});

export const adminCreateAppointmentOutputSchema = z.object({
  id: z.string().min(1),
});

export const adminGetAppointmentInputSchema = z.object({
  id: z.string().min(1),
});

export const adminGetAppointmentOutputSchema = z.object({
  appointment: z
    .object({
      id: z.string().min(1),
      status: z.nativeEnum(ServiceAppointmentStatus),
      date: z.string().min(1),
      timeWindow: z.string().min(1),
      rescheduledFromId: z.string().min(1).nullable(),
      rescheduledToId: z.string().min(1).nullable(),
    })
    .nullable(),
});

// Debug endpoint to look up customers by phone
export const adminLookupCustomerInputSchema = z.object({
  phoneE164: z.string().min(1),
});

export const adminLookupCustomerOutputSchema = z.object({
  customers: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      phoneE164: z.string(),
      zipCode: z.string().nullable(),
      addressSummary: z.string().nullable(),
    }),
  ),
});

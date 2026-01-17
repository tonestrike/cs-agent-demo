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

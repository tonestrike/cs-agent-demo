import { z } from "zod";

export const serviceAppointmentStatusSchema = z.enum([
  "scheduled",
  "rescheduled",
  "cancelled",
]);

export const serviceAppointmentSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  phoneE164: z.string(),
  addressSummary: z.string(),
  date: z.string(),
  timeWindow: z.string(),
  status: serviceAppointmentStatusSchema,
  rescheduledFromId: z.string().optional(),
  rescheduledToId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ServiceAppointment = z.infer<typeof serviceAppointmentSchema>;

export const serviceAppointmentListInputSchema = z.object({
  customerId: z.string().optional(),
  phoneE164: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const serviceAppointmentListOutputSchema = z.object({
  items: z.array(serviceAppointmentSchema),
  nextCursor: z.string().nullable(),
});

export type ServiceAppointmentListInput = z.infer<
  typeof serviceAppointmentListInputSchema
>;
export type ServiceAppointmentListOutput = z.infer<
  typeof serviceAppointmentListOutputSchema
>;

export const serviceAppointmentIdInputSchema = z.object({
  appointmentId: z.string().min(1),
});

export type ServiceAppointmentIdInput = z.infer<
  typeof serviceAppointmentIdInputSchema
>;

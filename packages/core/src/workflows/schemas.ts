import { z } from "zod";

export const workflowIntentSchema = z.enum(["verify", "reschedule", "cancel"]);

export const rescheduleWorkflowInputSchema = z.object({
  callSessionId: z.string().min(1),
  customerId: z.string().min(1),
  intent: z.literal("reschedule"),
  message: z.string().min(1),
  contextSummary: z.string().min(1).optional(),
});

export type RescheduleWorkflowInput = z.infer<
  typeof rescheduleWorkflowInputSchema
>;

export const rescheduleSelectAppointmentEventSchema = z.object({
  appointmentId: z.string().min(1),
});

export type RescheduleSelectAppointmentEvent = z.infer<
  typeof rescheduleSelectAppointmentEventSchema
>;

export const rescheduleSelectSlotEventSchema = z.object({
  slotId: z.string().min(1),
});

export type RescheduleSelectSlotEvent = z.infer<
  typeof rescheduleSelectSlotEventSchema
>;

export const rescheduleConfirmEventSchema = z.object({
  confirmed: z.boolean(),
});

export type RescheduleConfirmEvent = z.infer<
  typeof rescheduleConfirmEventSchema
>;

export const rescheduleWorkflowStatusSchema = z.enum([
  "rescheduled",
  "cancelled",
  "needs_followup",
]);

export const rescheduleWorkflowOutputSchema = z.object({
  status: rescheduleWorkflowStatusSchema,
  appointmentId: z.string().min(1).optional(),
  slotId: z.string().min(1).optional(),
  message: z.string().min(1),
});

export type RescheduleWorkflowOutput = z.infer<
  typeof rescheduleWorkflowOutputSchema
>;

export const rescheduleWorkflowStartInputSchema =
  rescheduleWorkflowInputSchema.extend({
    workflowInstanceId: z.string().min(1).optional(),
  });

export type RescheduleWorkflowStartInput = z.infer<
  typeof rescheduleWorkflowStartInputSchema
>;

export const rescheduleWorkflowStartOutputSchema = z.object({
  instanceId: z.string().min(1),
});

export type RescheduleWorkflowStartOutput = z.infer<
  typeof rescheduleWorkflowStartOutputSchema
>;

export const rescheduleWorkflowSelectAppointmentEventInputSchema = z.object({
  instanceId: z.string().min(1),
  payload: rescheduleSelectAppointmentEventSchema,
});

export type RescheduleWorkflowSelectAppointmentEventInput = z.infer<
  typeof rescheduleWorkflowSelectAppointmentEventInputSchema
>;

export const rescheduleWorkflowSelectSlotEventInputSchema = z.object({
  instanceId: z.string().min(1),
  payload: rescheduleSelectSlotEventSchema,
});

export type RescheduleWorkflowSelectSlotEventInput = z.infer<
  typeof rescheduleWorkflowSelectSlotEventInputSchema
>;

export const rescheduleWorkflowConfirmEventInputSchema = z.object({
  instanceId: z.string().min(1),
  payload: rescheduleConfirmEventSchema,
});

export type RescheduleWorkflowConfirmEventInput = z.infer<
  typeof rescheduleWorkflowConfirmEventInputSchema
>;

export const workflowEventAckSchema = z.object({
  ok: z.boolean(),
  instanceId: z.string().min(1),
});

export type WorkflowEventAck = z.infer<typeof workflowEventAckSchema>;

export const verifyWorkflowInputSchema = z.object({
  callSessionId: z.string().min(1),
  phoneE164: z.string().min(1),
  intent: z.literal("verify"),
});

export type VerifyWorkflowInput = z.infer<typeof verifyWorkflowInputSchema>;

export const verifyZipEventSchema = z.object({
  zipCode: z.string().regex(/^\d{5}$/),
});

export type VerifyZipEvent = z.infer<typeof verifyZipEventSchema>;

export const verifyWorkflowOutputSchema = z.object({
  status: z.enum(["verified", "escalated", "needs_followup"]),
  customerId: z.string().min(1).optional(),
  message: z.string().min(1),
});

export type VerifyWorkflowOutput = z.infer<typeof verifyWorkflowOutputSchema>;

export const verifyWorkflowStartInputSchema = verifyWorkflowInputSchema.extend({
  workflowInstanceId: z.string().min(1).optional(),
});

export type VerifyWorkflowStartInput = z.infer<
  typeof verifyWorkflowStartInputSchema
>;

export const verifyWorkflowStartOutputSchema = z.object({
  instanceId: z.string().min(1),
});

export type VerifyWorkflowStartOutput = z.infer<
  typeof verifyWorkflowStartOutputSchema
>;

export const verifyWorkflowZipEventInputSchema = z.object({
  instanceId: z.string().min(1),
  payload: verifyZipEventSchema,
});

export type VerifyWorkflowZipEventInput = z.infer<
  typeof verifyWorkflowZipEventInputSchema
>;

export const cancelWorkflowInputSchema = z.object({
  callSessionId: z.string().min(1),
  customerId: z.string().min(1),
  intent: z.literal("cancel"),
  message: z.string().min(1),
});

export type CancelWorkflowInput = z.infer<typeof cancelWorkflowInputSchema>;

export const cancelWorkflowOutputSchema = z.object({
  status: z.enum(["cancelled", "needs_followup", "escalated"]),
  appointmentId: z.string().min(1).optional(),
  message: z.string().min(1),
});

export type CancelWorkflowOutput = z.infer<typeof cancelWorkflowOutputSchema>;

export const cancelSelectAppointmentEventSchema = z.object({
  appointmentId: z.string().min(1),
});

export type CancelSelectAppointmentEvent = z.infer<
  typeof cancelSelectAppointmentEventSchema
>;

export const cancelConfirmEventSchema = z.object({
  confirmed: z.boolean(),
});

export type CancelConfirmEvent = z.infer<typeof cancelConfirmEventSchema>;

export const cancelWorkflowStartInputSchema = cancelWorkflowInputSchema.extend({
  workflowInstanceId: z.string().min(1).optional(),
});

export type CancelWorkflowStartInput = z.infer<
  typeof cancelWorkflowStartInputSchema
>;

export const cancelWorkflowStartOutputSchema = z.object({
  instanceId: z.string().min(1),
});

export type CancelWorkflowStartOutput = z.infer<
  typeof cancelWorkflowStartOutputSchema
>;

export const cancelWorkflowSelectAppointmentEventInputSchema = z.object({
  instanceId: z.string().min(1),
  payload: cancelSelectAppointmentEventSchema,
});

export type CancelWorkflowSelectAppointmentEventInput = z.infer<
  typeof cancelWorkflowSelectAppointmentEventInputSchema
>;

export const cancelWorkflowConfirmEventInputSchema = z.object({
  instanceId: z.string().min(1),
  payload: cancelConfirmEventSchema,
});

export type CancelWorkflowConfirmEventInput = z.infer<
  typeof cancelWorkflowConfirmEventInputSchema
>;

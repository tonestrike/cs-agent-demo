import { describe, expect, it } from "vitest";

import {
  cancelConfirmEventSchema,
  cancelSelectAppointmentEventSchema,
  cancelWorkflowInputSchema,
  cancelWorkflowOutputSchema,
  cancelWorkflowStartInputSchema,
  cancelWorkflowStartOutputSchema,
  rescheduleConfirmEventSchema,
  rescheduleSelectAppointmentEventSchema,
  rescheduleSelectSlotEventSchema,
  rescheduleWorkflowInputSchema,
  rescheduleWorkflowOutputSchema,
  rescheduleWorkflowStartInputSchema,
  rescheduleWorkflowStartOutputSchema,
  verifyWorkflowInputSchema,
  verifyWorkflowOutputSchema,
  verifyWorkflowStartInputSchema,
  verifyWorkflowStartOutputSchema,
  verifyZipEventSchema,
} from "./schemas";

describe("workflow schemas", () => {
  it("validates reschedule workflow input", () => {
    const result = rescheduleWorkflowInputSchema.safeParse({
      callSessionId: "call_123",
      customerId: "cust_001",
      intent: "reschedule",
      message: "Please move my appointment.",
      contextSummary: "Verified customer request.",
    });

    expect(result.success).toBe(true);
  });

  it("validates reschedule workflow start input", () => {
    const result = rescheduleWorkflowStartInputSchema.safeParse({
      callSessionId: "call_123",
      customerId: "cust_001",
      intent: "reschedule",
      message: "Please move my appointment.",
      workflowInstanceId: "wf_001",
    });

    expect(result.success).toBe(true);
  });

  it("validates reschedule workflow output", () => {
    const result = rescheduleWorkflowOutputSchema.safeParse({
      status: "rescheduled",
      appointmentId: "appt_001",
      slotId: "slot_001",
      message: "Appointment rescheduled.",
    });

    expect(result.success).toBe(true);
  });

  it("validates reschedule event payloads", () => {
    expect(
      rescheduleSelectAppointmentEventSchema.safeParse({
        appointmentId: "appt_001",
      }).success,
    ).toBe(true);
    expect(
      rescheduleSelectSlotEventSchema.safeParse({
        slotId: "slot_001",
      }).success,
    ).toBe(true);
    expect(
      rescheduleConfirmEventSchema.safeParse({
        confirmed: true,
      }).success,
    ).toBe(true);
  });

  it("validates reschedule workflow start output", () => {
    const result = rescheduleWorkflowStartOutputSchema.safeParse({
      instanceId: "wf_001",
    });

    expect(result.success).toBe(true);
  });

  it("validates verification workflow input and events", () => {
    const inputResult = verifyWorkflowInputSchema.safeParse({
      callSessionId: "call_123",
      phoneE164: "+14155550100",
      intent: "verify",
    });

    const eventResult = verifyZipEventSchema.safeParse({
      zipCode: "98109",
    });

    expect(inputResult.success).toBe(true);
    expect(eventResult.success).toBe(true);
  });

  it("validates verification workflow start input/output", () => {
    const inputResult = verifyWorkflowStartInputSchema.safeParse({
      callSessionId: "call_123",
      phoneE164: "+14155550100",
      intent: "verify",
      workflowInstanceId: "wf_verify",
    });
    const outputResult = verifyWorkflowStartOutputSchema.safeParse({
      instanceId: "wf_verify",
    });

    expect(inputResult.success).toBe(true);
    expect(outputResult.success).toBe(true);
  });

  it("validates verification workflow output", () => {
    const result = verifyWorkflowOutputSchema.safeParse({
      status: "verified",
      customerId: "cust_001",
      message: "Thanks, you're verified.",
    });

    expect(result.success).toBe(true);
  });

  it("validates cancel workflow input and events", () => {
    const inputResult = cancelWorkflowInputSchema.safeParse({
      callSessionId: "call_123",
      customerId: "cust_001",
      intent: "cancel",
      message: "Cancel my appointment.",
    });
    const selectResult = cancelSelectAppointmentEventSchema.safeParse({
      appointmentId: "appt_001",
    });
    const confirmResult = cancelConfirmEventSchema.safeParse({
      confirmed: true,
    });

    expect(inputResult.success).toBe(true);
    expect(selectResult.success).toBe(true);
    expect(confirmResult.success).toBe(true);
  });

  it("validates cancel workflow start input/output", () => {
    const inputResult = cancelWorkflowStartInputSchema.safeParse({
      callSessionId: "call_123",
      customerId: "cust_001",
      intent: "cancel",
      message: "Cancel my appointment.",
      workflowInstanceId: "wf_cancel",
    });
    const outputResult = cancelWorkflowStartOutputSchema.safeParse({
      instanceId: "wf_cancel",
    });

    expect(inputResult.success).toBe(true);
    expect(outputResult.success).toBe(true);
  });

  it("validates cancel workflow output", () => {
    const result = cancelWorkflowOutputSchema.safeParse({
      status: "cancelled",
      appointmentId: "appt_001",
      message: "Your appointment has been cancelled.",
    });

    expect(result.success).toBe(true);
  });
});

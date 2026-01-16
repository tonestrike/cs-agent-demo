import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import {
  type RescheduleWorkflowInput,
  type RescheduleWorkflowOutput,
  ServiceAppointmentStatus,
  rescheduleConfirmEventSchema,
  rescheduleSelectAppointmentEventSchema,
  rescheduleSelectSlotEventSchema,
  rescheduleWorkflowInputSchema,
} from "@pestcall/core";

import { createDependencies } from "../context";
import type { Env } from "../env";
import { defaultLogger } from "../logging";
import { rescheduleAppointment as rescheduleAppointmentInStore } from "../use-cases/appointments";
import {
  getAvailableSlots,
  listUpcomingAppointments,
  rescheduleAppointment as rescheduleAppointmentInCrm,
} from "../use-cases/crm";
import {
  RESCHEDULE_WORKFLOW_EVENT_CONFIRM,
  RESCHEDULE_WORKFLOW_EVENT_SELECT_APPOINTMENT,
  RESCHEDULE_WORKFLOW_EVENT_SELECT_SLOT,
} from "./constants";

const parseSummary = (summary: string | null) => {
  if (!summary) {
    return {};
  }
  try {
    return JSON.parse(summary) as Record<string, unknown>;
  } catch (error) {
    defaultLogger.warn(
      { error: error instanceof Error ? error.message : "unknown" },
      "workflow.reschedule.summary.parse_failed",
    );
    return {};
  }
};

const buildSummary = (summary: Record<string, unknown>) =>
  JSON.stringify(summary);

export class RescheduleWorkflow extends WorkflowEntrypoint<
  Env,
  RescheduleWorkflowInput
> {
  override async run(
    event: WorkflowEvent<RescheduleWorkflowInput>,
    step: WorkflowStep,
  ): Promise<RescheduleWorkflowOutput> {
    const payload = (
      "params" in event ? event.params : event.payload
    ) as RescheduleWorkflowInput;
    const input = rescheduleWorkflowInputSchema.safeParse(payload);
    if (!input.success) {
      throw new Error("Invalid reschedule workflow input.");
    }
    const params = input.data;
    const deps = createDependencies(this.env);
    const logger = deps.logger;

    const updateSummary = async (
      workflowStep: string,
      details: Record<string, unknown> = {},
    ) => {
      const session = await deps.calls.getSession(params.callSessionId);
      const existing = parseSummary(session?.summary ?? null);
      const detailValues = details as {
        appointmentOptions?: unknown;
        slotOptions?: unknown;
      };
      const existingValues = existing as {
        lastAppointmentOptions?: unknown;
        lastAvailableSlots?: unknown;
      };
      const appointmentOptions = detailValues.appointmentOptions;
      const slotOptions = detailValues.slotOptions;
      const nextSummary = {
        ...existing,
        workflowState: {
          kind: "reschedule",
          step: workflowStep,
          instanceId: event.instanceId,
          ...details,
        },
        lastAppointmentOptions: Array.isArray(appointmentOptions)
          ? appointmentOptions
          : (existingValues.lastAppointmentOptions ?? null),
        lastAvailableSlots: Array.isArray(slotOptions)
          ? slotOptions
          : (existingValues.lastAvailableSlots ?? null),
      };
      await deps.calls.updateSessionSummary({
        callSessionId: params.callSessionId,
        summary: buildSummary(nextSummary),
      });
    };

    logger.info(
      { callSessionId: params.callSessionId, instanceId: event.instanceId },
      "workflow.reschedule.start",
    );

    await step.do("record start", async () => {
      await updateSummary("start");
      return null;
    });

    const appointments = await step.do("list appointments", async () => {
      return listUpcomingAppointments(deps.crm, params.customerId, 3);
    });

    if (!appointments.length) {
      await step.do("record no appointments", async () => {
        await updateSummary("no_appointments");
        return null;
      });
      return {
        status: "needs_followup",
        message: "No upcoming appointments were found for this customer.",
      };
    }

    await step.do("record appointment options", async () => {
      await updateSummary("select_appointment", {
        appointmentOptions: appointments.map((appointment) => ({
          id: appointment.id,
          date: appointment.date,
          timeWindow: appointment.timeWindow,
          addressSummary: appointment.addressSummary,
        })),
      });
      return null;
    });

    let selectedAppointment =
      appointments.length === 1 ? appointments[0] : null;
    if (!selectedAppointment) {
      const selectionEvent = await step.waitForEvent("select appointment", {
        type: RESCHEDULE_WORKFLOW_EVENT_SELECT_APPOINTMENT,
        timeout: "24 hours",
      });
      const selection = rescheduleSelectAppointmentEventSchema.safeParse(
        selectionEvent.payload,
      );
      if (!selection.success) {
        throw new Error("Invalid appointment selection.");
      }
      selectedAppointment =
        appointments.find(
          (appointment) => appointment.id === selection.data.appointmentId,
        ) ?? null;
      if (!selectedAppointment) {
        throw new Error("Selected appointment was not found.");
      }
    }

    await step.do("record appointment selection", async () => {
      await updateSummary("select_appointment", {
        appointmentId: selectedAppointment.id,
      });
      return null;
    });

    const slots = await step.do("list available slots", async () => {
      return getAvailableSlots(deps.crm, params.customerId, {
        daysAhead: 14,
        preference: "any",
      });
    });

    if (!slots.length) {
      await step.do("record no slots", async () => {
        await updateSummary("no_slots", {
          appointmentId: selectedAppointment.id,
        });
        return null;
      });
      return {
        status: "needs_followup",
        appointmentId: selectedAppointment.id,
        message: "No available time slots were found.",
      };
    }

    await step.do("record slot options", async () => {
      await updateSummary("select_slot", {
        appointmentId: selectedAppointment.id,
        slotOptions: slots.map((slot) => ({
          id: slot.id,
          date: slot.date,
          timeWindow: slot.timeWindow,
        })),
      });
      return null;
    });

    let selectedSlot = slots.length === 1 ? slots[0] : null;
    if (!selectedSlot) {
      const slotEvent = await step.waitForEvent("select slot", {
        type: RESCHEDULE_WORKFLOW_EVENT_SELECT_SLOT,
        timeout: "24 hours",
      });
      const selection = rescheduleSelectSlotEventSchema.safeParse(
        slotEvent.payload,
      );
      if (!selection.success) {
        throw new Error("Invalid slot selection.");
      }
      selectedSlot =
        slots.find((slot) => slot.id === selection.data.slotId) ?? null;
      if (!selectedSlot) {
        throw new Error("Selected slot was not found.");
      }
    }

    await step.do("record slot selection", async () => {
      await updateSummary("select_slot", {
        appointmentId: selectedAppointment.id,
        slotId: selectedSlot.id,
      });
      return null;
    });

    await step.do("record awaiting confirmation", async () => {
      await updateSummary("confirm", {
        appointmentId: selectedAppointment.id,
        slotId: selectedSlot.id,
      });
      return null;
    });

    const confirmationEvent = await step.waitForEvent("confirm reschedule", {
      type: RESCHEDULE_WORKFLOW_EVENT_CONFIRM,
      timeout: "24 hours",
    });
    const confirmation = rescheduleConfirmEventSchema.safeParse(
      confirmationEvent.payload,
    );
    if (!confirmation.success) {
      throw new Error("Invalid confirmation payload.");
    }
    if (!confirmation.data.confirmed) {
      await step.do("record cancellation", async () => {
        await updateSummary("cancelled", {
          appointmentId: selectedAppointment.id,
          slotId: selectedSlot.id,
        });
        return null;
      });
      return {
        status: "cancelled",
        appointmentId: selectedAppointment.id,
        slotId: selectedSlot.id,
        message: "Reschedule cancelled.",
      };
    }

    const rescheduleResult = await step.do(
      "reschedule appointment",
      async () => {
        return rescheduleAppointmentInCrm(
          deps.crm,
          selectedAppointment.id,
          selectedSlot.id,
        );
      },
    );

    if (!rescheduleResult.ok) {
      await step.do("record failure", async () => {
        await updateSummary("failed", {
          appointmentId: selectedAppointment.id,
          slotId: selectedSlot.id,
        });
        return null;
      });
      return {
        status: "needs_followup",
        appointmentId: selectedAppointment.id,
        slotId: selectedSlot.id,
        message: "Unable to reschedule the appointment.",
      };
    }

    await step.do("update appointment cache", async () => {
      const existing = await deps.appointments.get(selectedAppointment.id);
      if (existing) {
        await rescheduleAppointmentInStore(deps.appointments, {
          appointment: existing,
          slot: {
            date: selectedSlot.date,
            timeWindow: selectedSlot.timeWindow,
          },
        });
        return null;
      }
      const customer = await deps.customers.get(params.customerId);
      if (!customer?.phoneE164) {
        return null;
      }
      await deps.appointments.upsert({
        id: selectedAppointment.id,
        customerId: selectedAppointment.customerId,
        phoneE164: customer.phoneE164,
        addressSummary: selectedAppointment.addressSummary,
        date: selectedSlot.date,
        timeWindow: selectedSlot.timeWindow,
        status: ServiceAppointmentStatus.Scheduled,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return null;
    });

    await step.do("record completion", async () => {
      await updateSummary("complete", {
        appointmentId: selectedAppointment.id,
        slotId: selectedSlot.id,
      });
      return null;
    });

    logger.info(
      {
        callSessionId: params.callSessionId,
        instanceId: event.instanceId,
        appointmentId: selectedAppointment.id,
        slotId: selectedSlot.id,
      },
      "workflow.reschedule.complete",
    );

    return {
      status: "rescheduled",
      appointmentId: selectedAppointment.id,
      slotId: selectedSlot.id,
      message: "Appointment rescheduled.",
    };
  }
}

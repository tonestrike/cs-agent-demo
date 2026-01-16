import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import {
  type CancelWorkflowInput,
  type CancelWorkflowOutput,
  ServiceAppointmentStatus,
  cancelConfirmEventSchema,
  cancelSelectAppointmentEventSchema,
  cancelWorkflowInputSchema,
} from "@pestcall/core";

import { createDependencies } from "../context";
import type { Env } from "../env";
import type { Logger } from "../logger";
import { cancelAppointment as cancelAppointmentInStore } from "../use-cases/appointments";
import {
  cancelAppointment as cancelAppointmentInCrm,
  listUpcomingAppointments,
} from "../use-cases/crm";
import {
  CANCEL_WORKFLOW_EVENT_CONFIRM,
  CANCEL_WORKFLOW_EVENT_SELECT_APPOINTMENT,
} from "./constants";

const parseSummary = (summary: string | null, logger: Logger) => {
  if (!summary) {
    return {};
  }
  try {
    return JSON.parse(summary) as Record<string, unknown>;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "unknown" },
      "workflow.cancel.summary.parse_failed",
    );
    return {};
  }
};

const buildSummary = (summary: Record<string, unknown>) =>
  JSON.stringify(summary);

export class CancelWorkflow extends WorkflowEntrypoint<
  Env,
  CancelWorkflowInput
> {
  override async run(
    event: WorkflowEvent<CancelWorkflowInput>,
    step: WorkflowStep,
  ): Promise<CancelWorkflowOutput> {
    const deps = createDependencies(this.env);
    const logger = deps.logger;
    const payload = (
      "params" in event ? event.params : event.payload
    ) as CancelWorkflowInput;
    const input = cancelWorkflowInputSchema.safeParse(payload);
    if (!input.success) {
      logger.error(
        {
          instanceId: event.instanceId,
          payload,
          issues: input.error.issues,
        },
        "workflow.cancel.invalid_input",
      );
      throw new Error("Invalid cancel workflow input.");
    }
    const params = input.data;

    const updateSummary = async (
      workflowStep: string,
      details: Record<string, unknown> = {},
    ) => {
      const session = await deps.calls.getSession(params.callSessionId);
      const existing = parseSummary(session?.summary ?? null, logger);
      const detailValues = details as {
        appointmentOptions?: unknown;
      };
      const existingValues = existing as {
        lastAppointmentOptions?: unknown;
      };
      const appointmentOptions = detailValues.appointmentOptions;
      const nextSummary = {
        ...existing,
        workflowState: {
          kind: "cancel",
          step: workflowStep,
          instanceId: event.instanceId,
          ...details,
        },
        lastAppointmentOptions: Array.isArray(appointmentOptions)
          ? appointmentOptions
          : (existingValues.lastAppointmentOptions ?? null),
      };
      await deps.calls.updateSessionSummary({
        callSessionId: params.callSessionId,
        summary: buildSummary(nextSummary),
      });
    };

    logger.info(
      { callSessionId: params.callSessionId, instanceId: event.instanceId },
      "workflow.cancel.start",
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
        message: "No upcoming appointments were found to cancel.",
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
        type: CANCEL_WORKFLOW_EVENT_SELECT_APPOINTMENT,
        timeout: "24 hours",
      });
      const selection = cancelSelectAppointmentEventSchema.safeParse(
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
      await updateSummary("confirm", {
        appointmentId: selectedAppointment.id,
      });
      return null;
    });

    const confirmationEvent = await step.waitForEvent("confirm cancellation", {
      type: CANCEL_WORKFLOW_EVENT_CONFIRM,
      timeout: "24 hours",
    });
    const confirmation = cancelConfirmEventSchema.safeParse(
      confirmationEvent.payload,
    );
    if (!confirmation.success) {
      throw new Error("Invalid confirmation payload.");
    }
    if (!confirmation.data.confirmed) {
      await step.do("record declined", async () => {
        await updateSummary("declined", {
          appointmentId: selectedAppointment.id,
        });
        return null;
      });
      return {
        status: "needs_followup",
        appointmentId: selectedAppointment.id,
        message: "Okay, I won't cancel that appointment.",
      };
    }

    const cancelResult = await step.do("cancel appointment", async () => {
      return cancelAppointmentInCrm(deps.crm, selectedAppointment.id);
    });

    if (!cancelResult.ok) {
      await step.do("record escalation", async () => {
        await updateSummary("escalate", {
          appointmentId: selectedAppointment.id,
        });
        await deps.crm.escalate({
          reason: "Cancellation failed",
          summary: "Unable to cancel appointment automatically.",
          customerId: params.customerId,
          appointmentId: selectedAppointment.id,
        });
        return null;
      });
      return {
        status: "escalated",
        appointmentId: selectedAppointment.id,
        message:
          "I couldn't cancel that appointment. I'll connect you with a specialist.",
      };
    }

    await step.do("update appointment cache", async () => {
      const existing = await deps.appointments.get(selectedAppointment.id);
      if (existing) {
        await cancelAppointmentInStore(deps.appointments, {
          appointment: existing,
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
        date: selectedAppointment.date,
        timeWindow: selectedAppointment.timeWindow,
        status: ServiceAppointmentStatus.Cancelled,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return null;
    });

    await step.do("record completion", async () => {
      await updateSummary("complete", {
        appointmentId: selectedAppointment.id,
      });
      return null;
    });

    logger.info(
      {
        callSessionId: params.callSessionId,
        instanceId: event.instanceId,
        appointmentId: selectedAppointment.id,
      },
      "workflow.cancel.complete",
    );

    return {
      status: "cancelled",
      appointmentId: selectedAppointment.id,
      message: "Your appointment has been cancelled.",
    };
  }
}

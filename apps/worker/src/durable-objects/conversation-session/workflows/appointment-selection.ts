/**
 * Appointment selection handler
 *
 * Handles user selections (appointments, slots, confirmations) for
 * cancel and reschedule workflows.
 *
 * All interpretation of user input is delegated to the model for flexibility.
 * The model is responsible for understanding user intent and selecting
 * the appropriate option.
 */

import {
  applyIntent,
  initialConversationState,
} from "../../../conversation/state-machine";
import type {
  AgentMessageInput,
  AgentMessageOutput,
} from "../../../schemas/agent";
import { getAvailableSlots } from "../../../use-cases/crm";
import {
  CANCEL_WORKFLOW_EVENT_CONFIRM,
  CANCEL_WORKFLOW_EVENT_SELECT_APPOINTMENT,
  RESCHEDULE_WORKFLOW_EVENT_CONFIRM,
  RESCHEDULE_WORKFLOW_EVENT_SELECT_APPOINTMENT,
  RESCHEDULE_WORKFLOW_EVENT_SELECT_SLOT,
} from "../../../workflows/constants";
import {
  formatAppointmentsResponse,
  formatAvailableSlotsResponse,
} from "../formatters";
import {
  CONFIRMATION_OPTIONS,
  buildAppointmentOptions,
  buildSlotOptions,
  getExpectedSelectionKind,
  isSelectionStale,
} from "./appointment-helpers";
import type { WorkflowContext } from "./types";

/** Result of workflow selection handling */
export type SelectionResult = {
  handled: boolean;
  output?: AgentMessageOutput;
};

/**
 * Handle workflow selection from user input.
 *
 * This function is fully model-driven - all interpretation of user input
 * is delegated to the model via ctx.selectOption(). This allows the model
 * to understand natural language selections like "the first one", "January 15th",
 * "yes please", etc. without hardcoded pattern matching.
 *
 * Returns { handled: true, output } if the selection was processed,
 * or { handled: false } if no workflow selection applies.
 */
export async function handleWorkflowSelection(
  ctx: WorkflowContext,
  input: AgentMessageInput,
): Promise<SelectionResult> {
  const callSessionId = input.callSessionId ?? ctx.callSessionId;
  if (!callSessionId) {
    return { handled: false };
  }

  // No active workflows - nothing to handle
  if (
    !ctx.sessionState.cancelWorkflowId &&
    !ctx.sessionState.rescheduleWorkflowId
  ) {
    return { handled: false };
  }

  // Clear stale selections
  if (isSelectionStale(ctx.sessionState.activeSelection?.presentedAt)) {
    await ctx.updateState({ activeSelection: undefined });
  }

  // Determine expected selection kind from conversation state
  const expectedKind = getExpectedSelectionKind(ctx.sessionState.conversation);

  ctx.logger.info(
    {
      callSessionId,
      cancelWorkflowId: ctx.sessionState.cancelWorkflowId ?? null,
      rescheduleWorkflowId: ctx.sessionState.rescheduleWorkflowId ?? null,
      appointmentsCount:
        ctx.sessionState.conversation?.appointments.length ?? 0,
      availableSlotsCount: ctx.sessionState.availableSlots?.length ?? 0,
      inputText: input.text,
      expectedSelectionKind: expectedKind,
      conversationStatus: ctx.sessionState.conversation?.status ?? null,
    },
    "conversation.session.appointment.selection",
  );

  // Build options based on current state
  const appointments = ctx.sessionState.conversation?.appointments ?? [];
  const appointmentOptions = buildAppointmentOptions(appointments);
  const availableSlots = ctx.sessionState.availableSlots ?? [];
  const slotOptions = buildSlotOptions(availableSlots);

  // Use model to interpret user selection - no regex parsing
  let resolvedAppointmentId: string | null = null;
  let resolvedSlotId: string | null = null;
  let confirmation: boolean | null = null;

  // Let the model interpret the user's input based on expected kind
  if (expectedKind) {
    switch (expectedKind) {
      case "confirmation": {
        const selected = await ctx.selectOption(
          input,
          "confirmation",
          CONFIRMATION_OPTIONS,
        );
        if (selected === "confirm") {
          confirmation = true;
        } else if (selected === "decline") {
          confirmation = false;
        }
        break;
      }
      case "appointment": {
        if (appointmentOptions.length) {
          resolvedAppointmentId = await ctx.selectOption(
            input,
            "appointment",
            appointmentOptions,
          );
        }
        break;
      }
      case "slot": {
        if (slotOptions.length) {
          resolvedSlotId = await ctx.selectOption(input, "slot", slotOptions);
        }
        break;
      }
    }
  }

  // Handle cancel workflow
  const cancelWorkflowId = ctx.sessionState.cancelWorkflowId;
  if (cancelWorkflowId) {
    const result = await handleCancelSelection(
      ctx,
      input,
      callSessionId,
      cancelWorkflowId,
      {
        resolvedAppointmentId,
        confirmation,
        appointments,
      },
    );
    if (result.handled) {
      return result;
    }
  }

  // Handle reschedule workflow
  const rescheduleWorkflowId = ctx.sessionState.rescheduleWorkflowId;
  if (rescheduleWorkflowId) {
    const result = await handleRescheduleSelection(
      ctx,
      input,
      callSessionId,
      rescheduleWorkflowId,
      {
        resolvedAppointmentId,
        resolvedSlotId,
        confirmation,
        appointments,
        availableSlots,
      },
    );
    if (result.handled) {
      return result;
    }
  }

  return { handled: false };
}

/** Handle selection for cancel workflow */
async function handleCancelSelection(
  ctx: WorkflowContext,
  input: AgentMessageInput,
  callSessionId: string,
  workflowId: string,
  state: {
    resolvedAppointmentId: string | null;
    confirmation: boolean | null;
    appointments: Array<{
      id: string;
      date: string;
      timeWindow: string;
      addressSummary: string;
    }>;
  },
): Promise<SelectionResult> {
  const { resolvedAppointmentId, confirmation, appointments } = state;

  if (resolvedAppointmentId) {
    const instance = await ctx.deps.workflows.cancel?.get(workflowId);
    if (instance) {
      await instance.sendEvent({
        type: CANCEL_WORKFLOW_EVENT_SELECT_APPOINTMENT,
        payload: { appointmentId: resolvedAppointmentId },
      });

      const current =
        ctx.sessionState.conversation ?? initialConversationState();
      await ctx.updateState({
        conversation: applyIntent(current, {
          type: "cancel_requested",
          appointmentId: resolvedAppointmentId,
        }),
      });

      const replyText = await ctx.narrateText(
        input,
        "Confirm cancelling this appointment?",
        "Ask the customer to confirm cancelling the selected appointment.",
      );
      return {
        handled: true,
        output: { callSessionId, replyText, actions: [] },
      };
    }
  }

  if (confirmation !== null) {
    const instance = await ctx.deps.workflows.cancel?.get(workflowId);
    if (instance) {
      await instance.sendEvent({
        type: CANCEL_WORKFLOW_EVENT_CONFIRM,
        payload: { confirmed: confirmation },
      });

      const current =
        ctx.sessionState.conversation ?? initialConversationState();
      await ctx.updateState({
        conversation: applyIntent(current, {
          type: confirmation ? "cancel_confirmed" : "cancel_declined",
        }),
        availableSlots: undefined,
      });

      const replyText = await ctx.narrateText(
        input,
        confirmation
          ? "Thanks. I'll cancel that appointment now."
          : "Okay, I won't cancel that appointment.",
        "Confirm or acknowledge the cancellation decision.",
      );
      return {
        handled: true,
        output: { callSessionId, replyText, actions: [] },
      };
    }
  }

  // Present appointments if available
  if (appointments.length) {
    const customerId =
      ctx.sessionState.conversation?.verification.customerId ?? "";
    const replyText = await ctx.narrateToolResult(
      {
        toolName: "crm.listUpcomingAppointments",
        result: appointments.map((appointment) => ({
          id: appointment.id,
          customerId,
          date: appointment.date,
          timeWindow: appointment.timeWindow,
          addressSummary: appointment.addressSummary,
        })),
      },
      {
        input,
        fallback: formatAppointmentsResponse(appointments),
        contextHint: "Ask which appointment to cancel using the list.",
      },
    );
    return {
      handled: true,
      output: { callSessionId, replyText, actions: [] },
    };
  }

  return { handled: false };
}

/** Handle selection for reschedule workflow */
async function handleRescheduleSelection(
  ctx: WorkflowContext,
  input: AgentMessageInput,
  callSessionId: string,
  workflowId: string,
  state: {
    resolvedAppointmentId: string | null;
    resolvedSlotId: string | null;
    confirmation: boolean | null;
    appointments: Array<{
      id: string;
      date: string;
      timeWindow: string;
      addressSummary: string;
    }>;
    availableSlots: Array<{ id: string; date: string; timeWindow: string }>;
  },
): Promise<SelectionResult> {
  const {
    resolvedAppointmentId,
    resolvedSlotId,
    confirmation,
    appointments,
    availableSlots,
  } = state;

  if (resolvedAppointmentId) {
    const instance = await ctx.deps.workflows.reschedule?.get(workflowId);
    if (instance) {
      await instance.sendEvent({
        type: RESCHEDULE_WORKFLOW_EVENT_SELECT_APPOINTMENT,
        payload: { appointmentId: resolvedAppointmentId },
      });

      const customerId =
        ctx.sessionState.conversation?.verification.customerId ?? null;
      const slots = customerId
        ? await getAvailableSlots(ctx.deps.crm, customerId, { daysAhead: 14 })
        : [];

      await ctx.updateState({
        availableSlots: slots.map((slot) => ({
          id: slot.id,
          date: slot.date,
          timeWindow: slot.timeWindow,
        })),
        conversation: applyIntent(
          ctx.sessionState.conversation ?? initialConversationState(),
          {
            type: "reschedule_requested",
            appointmentId: resolvedAppointmentId,
          },
        ),
      });

      const replyText = await ctx.narrateToolResult(
        {
          toolName: "crm.getAvailableSlots",
          result: slots.map((slot) => ({
            id: slot.id,
            date: slot.date,
            timeWindow: slot.timeWindow,
          })),
        },
        {
          input,
          fallback: slots.length
            ? formatAvailableSlotsResponse(slots, "Which one works best?")
            : "I couldn't find any available times right now. Would you like me to check again later?",
          contextHint:
            "Offer available reschedule slots and ask which one they prefer.",
        },
      );
      return {
        handled: true,
        output: { callSessionId, replyText, actions: [] },
      };
    }
  }

  if (resolvedSlotId) {
    const instance = await ctx.deps.workflows.reschedule?.get(workflowId);
    if (instance) {
      await instance.sendEvent({
        type: RESCHEDULE_WORKFLOW_EVENT_SELECT_SLOT,
        payload: { slotId: resolvedSlotId },
      });

      await ctx.updateState({
        conversation: applyIntent(
          ctx.sessionState.conversation ?? initialConversationState(),
          {
            type: "reschedule_slot_selected",
            slotId: resolvedSlotId,
          },
        ),
      });

      const replyText = await ctx.narrateText(
        input,
        "Confirm the new appointment time?",
        "Ask the customer to confirm the new appointment time.",
      );
      return {
        handled: true,
        output: { callSessionId, replyText, actions: [] },
      };
    }
  }

  if (confirmation !== null) {
    const instance = await ctx.deps.workflows.reschedule?.get(workflowId);
    if (instance) {
      await instance.sendEvent({
        type: RESCHEDULE_WORKFLOW_EVENT_CONFIRM,
        payload: { confirmed: confirmation },
      });

      await ctx.updateState({
        availableSlots: undefined,
        conversation: applyIntent(
          ctx.sessionState.conversation ?? initialConversationState(),
          {
            type: confirmation ? "reschedule_confirmed" : "reschedule_declined",
          },
        ),
      });

      const replyText = await ctx.narrateText(
        input,
        confirmation
          ? "Thanks. I'll finalize the reschedule now."
          : "Okay, I won't change the appointment.",
        "Confirm or acknowledge the reschedule decision.",
      );
      return {
        handled: true,
        output: { callSessionId, replyText, actions: [] },
      };
    }
  }

  // Present slots if available
  if (availableSlots.length) {
    const replyText = await ctx.narrateToolResult(
      {
        toolName: "crm.getAvailableSlots",
        result: availableSlots.map((slot) => ({
          date: slot.date,
          timeWindow: slot.timeWindow,
        })),
      },
      {
        input,
        fallback: formatAvailableSlotsResponse(
          availableSlots,
          "Which one works best?",
        ),
        contextHint:
          "Offer available reschedule slots and ask which one they prefer.",
      },
    );
    return {
      handled: true,
      output: { callSessionId, replyText, actions: [] },
    };
  }

  // Present appointments if available
  if (appointments.length) {
    const customerId =
      ctx.sessionState.conversation?.verification.customerId ?? "";
    const replyText = await ctx.narrateToolResult(
      {
        toolName: "crm.listUpcomingAppointments",
        result: appointments.map((appointment) => ({
          id: appointment.id,
          customerId,
          date: appointment.date,
          timeWindow: appointment.timeWindow,
          addressSummary: appointment.addressSummary,
        })),
      },
      {
        input,
        fallback: formatAppointmentsResponse(appointments),
        contextHint: "Ask which appointment to reschedule using the list.",
      },
    );
    return {
      handled: true,
      output: { callSessionId, replyText, actions: [] },
    };
  }

  return { handled: false };
}

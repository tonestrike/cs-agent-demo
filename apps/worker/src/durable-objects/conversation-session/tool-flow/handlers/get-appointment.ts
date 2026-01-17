/**
 * Handler for crm.getNextAppointment and crm.getAppointmentById tools
 */

import { formatAppointmentsResponse } from "../../formatters";
import type {
  ToolExecutionInput,
  ToolFlowContext,
  ToolRawResult,
} from "../types";

export async function handleGetNextAppointment(
  ctx: ToolFlowContext,
  { args }: ToolExecutionInput<"crm.getNextAppointment">,
): Promise<ToolRawResult> {
  const customerId =
    args.customerId ??
    ctx.sessionState.conversation?.verification.customerId ??
    "";

  const appointment = await ctx.deps.crm.getNextAppointment(customerId);

  if (!appointment) {
    return {
      toolName: "crm.getNextAppointment",
      result: null,
      fallback:
        "I couldn't find any upcoming appointments. Would you like to schedule one?",
      contextHint: "No appointments found. Offer to schedule one.",
    };
  }

  return {
    toolName: "crm.getNextAppointment",
    result: {
      id: appointment.id,
      date: appointment.date,
      timeWindow: appointment.timeWindow,
      addressSummary: appointment.addressSummary,
      ...(appointment.addressId ? { addressId: appointment.addressId } : {}),
    },
    fallback: formatAppointmentsResponse([
      {
        id: appointment.id,
        date: appointment.date,
        timeWindow: appointment.timeWindow,
        addressSummary: appointment.addressSummary,
      },
    ]),
    contextHint: "Share the next appointment details.",
  };
}

export async function handleGetAppointmentById(
  ctx: ToolFlowContext,
  { args }: ToolExecutionInput<"crm.getAppointmentById">,
): Promise<ToolRawResult> {
  const { appointmentId } = args;

  const appointment = await ctx.deps.crm.getAppointmentById(appointmentId);

  if (!appointment) {
    return {
      toolName: "crm.getAppointmentById",
      result: null,
      fallback:
        "I couldn't find that appointment. Want me to list upcoming appointments?",
      contextHint: "Appointment not found. Offer alternatives.",
    };
  }

  return {
    toolName: "crm.getAppointmentById",
    result: {
      id: appointment.id,
      date: appointment.date,
      timeWindow: appointment.timeWindow,
      addressSummary: appointment.addressSummary,
      ...(appointment.addressId ? { addressId: appointment.addressId } : {}),
    },
    fallback: formatAppointmentsResponse([
      {
        id: appointment.id,
        date: appointment.date,
        timeWindow: appointment.timeWindow,
        addressSummary: appointment.addressSummary,
      },
    ]),
    contextHint: "Share the appointment details.",
  };
}

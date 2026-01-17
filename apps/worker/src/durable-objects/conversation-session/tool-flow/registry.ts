/**
 * Tool handler registry
 *
 * Maps tool names to their handler functions.
 * Uses typed handlers that receive validated args.
 */

import type { AgentToolName } from "../../../models/tool-definitions";
import { handleEscalate } from "./handlers/escalate";
import {
  handleGetAppointmentById,
  handleGetNextAppointment,
} from "./handlers/get-appointment";
import { handleGetAvailableSlots } from "./handlers/get-available-slots";
import { handleGetInvoices } from "./handlers/get-invoices";
import { handleListAppointments } from "./handlers/list-appointments";
import { handleGetServicePolicy } from "./handlers/service-policy";
import type { ToolHandler, ToolHandlerRegistry } from "./types";

/**
 * Registry of tool handlers by tool name.
 * Each handler receives validated, typed args.
 */
export const toolHandlerRegistry: ToolHandlerRegistry = {
  "crm.listUpcomingAppointments": handleListAppointments,
  "crm.getNextAppointment": handleGetNextAppointment,
  "crm.getAppointmentById": handleGetAppointmentById,
  "crm.getAvailableSlots": handleGetAvailableSlots,
  "crm.getOpenInvoices": handleGetInvoices,
  "crm.getServicePolicy": handleGetServicePolicy,
  "crm.escalate": handleEscalate,
  "agent.escalate": handleEscalate,
};

/**
 * Get a handler for a tool by name.
 * Returns undefined if no handler is registered.
 */
export function getToolHandler<T extends AgentToolName>(
  toolName: T,
): ToolHandler<T> | undefined {
  return toolHandlerRegistry[toolName] as ToolHandler<T> | undefined;
}

/**
 * Check if a tool has a registered handler.
 */
export function hasToolHandler(toolName: string): boolean {
  return toolName in toolHandlerRegistry;
}

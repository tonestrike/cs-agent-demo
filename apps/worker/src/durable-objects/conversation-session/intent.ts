/**
 * Intent Detection and Handling
 *
 * Detects customer intents from messages and defines
 * how each intent should be handled after verification.
 *
 * Uses a generic tool-based approach to support arbitrary domains.
 */

import { listUpcomingAppointments } from "../../use-cases/crm";
import type { ToolRawResult } from "./tool-flow/types";
import type { AppointmentData, SessionState } from "./types";

/** Intent kinds that can be detected */
export type IntentKind = NonNullable<SessionState["pendingIntent"]>["kind"];

/** Selection option for workflow tools */
export type SelectionOption = { id: string; label: string };

/**
 * Generic prerequisite tool configuration.
 * Defines a tool to call and how to process its results.
 */
export type PrerequisiteTool<TResult = unknown> = {
  /** Tool name for logging/debugging */
  name: string;
  /** Execute the tool and return results */
  execute: (ctx: IntentProcessingContext) => Promise<TResult[]>;
  /** Format results for display to customer */
  formatResults: (results: TResult[]) => string;
  /** Build selection options from results (for workflow tools) */
  buildOptions?: (results: TResult[]) => SelectionOption[];
};

/** Configuration for how an intent should be handled after verification */
export type IntentConfig<TResult = unknown> = {
  /** Tool to call before presenting results (generic approach) */
  prerequisiteTool?: PrerequisiteTool<TResult>;
  /** The workflow type if this starts a selection flow */
  workflowType?: "reschedule" | "cancel";
  /** Message when results are empty */
  emptyResultMessage: (customerName: string) => string;
  /** Message when results are found */
  resultsFoundMessage: (
    customerName: string,
    formattedResults: string,
  ) => string;
  /** Context hint for the model */
  contextHint: string;
  /** Context hint when no results found */
  emptyResultContextHint: string;
};

/** Type-erased intent config for the registry (allows heterogeneous tool types) */
// biome-ignore lint/suspicious/noExplicitAny: Registry needs to hold configs with different result types
type AnyIntentConfig = IntentConfig<any>;

/**
 * Appointment-specific prerequisite tool.
 * This demonstrates how to define a domain-specific tool.
 */
const appointmentPrerequisiteTool: PrerequisiteTool<AppointmentData> = {
  name: "crm.listAppointments",
  execute: async (ctx) => {
    return listUpcomingAppointments(ctx.crm, ctx.customerId, 3);
  },
  formatResults: (appointments) => {
    return appointments
      .map(
        (apt, i) =>
          `${i + 1}. ${apt.date} ${apt.timeWindow} at ${apt.addressSummary}`,
      )
      .join("\n");
  },
  buildOptions: (appointments) => {
    return appointments.map((apt) => ({
      id: apt.id,
      label: `${apt.date} ${apt.timeWindow} - ${apt.addressSummary}`,
    }));
  },
};

/**
 * Registry of intent configurations.
 * Defines how each intent should be handled after verification.
 *
 * To add a new intent:
 * 1. Add the kind to SessionState["pendingIntent"]["kind"]
 * 2. Add detection logic to detectActionIntent()
 * 3. Add configuration here with appropriate prerequisiteTool
 */
export const intentConfigs: Partial<Record<IntentKind, AnyIntentConfig>> = {
  reschedule: {
    prerequisiteTool: appointmentPrerequisiteTool,
    workflowType: "reschedule",
    emptyResultMessage: (name) =>
      `Thanks ${name}! I checked and you don't have any upcoming appointments to reschedule. Would you like to schedule a new appointment?`,
    resultsFoundMessage: (name, list) =>
      `Thanks ${name}! Here are your upcoming appointments:\n${list}\n\nWhich one would you like to reschedule?`,
    contextHint:
      "Customer verified and wants to reschedule. Present their appointments and ask which one to reschedule.",
    emptyResultContextHint:
      "Customer verified but has no upcoming appointments to reschedule. Offer to schedule a new one.",
  },
  cancel: {
    prerequisiteTool: appointmentPrerequisiteTool,
    workflowType: "cancel",
    emptyResultMessage: (name) =>
      `Thanks ${name}! I checked and you don't have any upcoming appointments to cancel.`,
    resultsFoundMessage: (name, list) =>
      `Thanks ${name}! Here are your upcoming appointments:\n${list}\n\nWhich one would you like to cancel?`,
    contextHint:
      "Customer verified and wants to cancel. Present their appointments and ask which one to cancel.",
    emptyResultContextHint:
      "Customer verified but has no upcoming appointments to cancel.",
  },
  appointments: {
    prerequisiteTool: appointmentPrerequisiteTool,
    emptyResultMessage: (name) =>
      `Thanks ${name}! I checked and you don't have any upcoming appointments scheduled.`,
    resultsFoundMessage: (name, list) =>
      `Thanks ${name}! Here are your upcoming appointments:\n${list}\n\nIs there anything you'd like to do with any of these?`,
    contextHint:
      "Customer verified and asked about appointments. Show their appointments and ask if they need help with any.",
    emptyResultContextHint:
      "Customer verified but has no upcoming appointments. Ask if they'd like to schedule one.",
  },
};

/**
 * Detect action intent from user message text.
 */
export const detectActionIntent = (
  text: string,
): SessionState["pendingIntent"] | null => {
  const lower = (text || "").toLowerCase();
  if (lower.includes("resched")) {
    return { kind: "reschedule", text };
  }
  if (lower.includes("cancel")) {
    return { kind: "cancel", text };
  }
  if (lower.includes("schedule") || lower.includes("book")) {
    return { kind: "schedule", text };
  }
  if (lower.includes("appointment")) {
    return { kind: "appointments", text };
  }
  return null;
};

/**
 * Context needed to process a pending intent after verification.
 */
export type IntentProcessingContext = {
  /** CRM dependency for fetching data */
  crm: Parameters<typeof listUpcomingAppointments>[0];
  /** Verified customer ID */
  customerId: string;
  /** Customer display name */
  customerName: string;
  /** Current conversation state getter */
  getConversationState: () => SessionState["conversation"];
};

/**
 * Process a pending intent after successful verification.
 * Returns a tool result if the intent was processed, null otherwise.
 *
 * This is a generic processor that works with any intent configuration.
 * The prerequisiteTool defines what data to fetch and how to format it.
 */
export async function processPendingIntent(
  pendingIntent: SessionState["pendingIntent"],
  ctx: IntentProcessingContext,
): Promise<ToolRawResult | null> {
  if (!pendingIntent) return null;

  const config = intentConfigs[pendingIntent.kind];
  if (!config) return null;

  // Build base state updates for successful verification
  const currentConversation = ctx.getConversationState();
  const baseStateUpdates: ToolRawResult["stateUpdates"] = {
    conversation: {
      status: "VerifiedIdle",
      verification: {
        verified: true,
        customerId: ctx.customerId,
        zipAttempts: 0,
      },
      // Preserve existing conversation state fields
      appointments: currentConversation?.appointments ?? [],
      pendingCancellationId: currentConversation?.pendingCancellationId ?? null,
      pendingRescheduleId: currentConversation?.pendingRescheduleId ?? null,
      pendingRescheduleSlotId:
        currentConversation?.pendingRescheduleSlotId ?? null,
      pendingScheduleSlotId: currentConversation?.pendingScheduleSlotId ?? null,
      pendingScheduleAddressConfirmed:
        currentConversation?.pendingScheduleAddressConfirmed ?? false,
    },
    pendingIntent: undefined,
  };

  // If no prerequisite tool, just return verified state
  if (!config.prerequisiteTool) {
    return {
      toolName: "crm.verifyAccount",
      result: {
        verified: true,
        customerId: ctx.customerId,
        customerName: ctx.customerName,
        pendingIntent: pendingIntent.kind,
        message: "Account verified.",
      },
      fallback: `Thank you ${ctx.customerName}! Your account has been verified.`,
      contextHint: config.contextHint,
      stateUpdates: baseStateUpdates,
    };
  }

  // Execute the prerequisite tool
  const results = await config.prerequisiteTool.execute(ctx);

  // Handle empty results
  if (results.length === 0) {
    return {
      toolName: "crm.verifyAccount",
      result: {
        verified: true,
        customerId: ctx.customerId,
        customerName: ctx.customerName,
        pendingIntent: pendingIntent.kind,
        results: [],
        message: "Account verified. No results found.",
      },
      fallback: config.emptyResultMessage(ctx.customerName),
      contextHint: config.emptyResultContextHint,
      stateUpdates: baseStateUpdates,
    };
  }

  // Format results for display
  const formattedResults = config.prerequisiteTool.formatResults(results);

  // Build state updates with active selection if this is a workflow intent
  const stateUpdates = { ...baseStateUpdates };

  if (config.workflowType && config.prerequisiteTool.buildOptions) {
    const options = config.prerequisiteTool.buildOptions(results);
    stateUpdates.activeSelection = {
      kind: "appointment",
      options,
      presentedAt: Date.now(),
      workflowType: config.workflowType,
    };
  }

  return {
    toolName: "crm.verifyAccount",
    result: {
      verified: true,
      customerId: ctx.customerId,
      customerName: ctx.customerName,
      pendingIntent: pendingIntent.kind,
      results,
      message: "Account verified. Ready to proceed.",
    },
    fallback: config.resultsFoundMessage(ctx.customerName, formattedResults),
    contextHint: config.contextHint,
    stateUpdates,
  };
}

import {
  type ServiceAppointment,
  ServiceAppointmentStatus,
  TicketCategory,
  TicketSource,
  normalizePhoneE164,
} from "@pestcall/core";
import { z } from "zod";
import type { Dependencies } from "../context";
import type { Logger } from "../logger";
import {
  type AgentToolName,
  toolDefinitions,
  validateToolArgs,
  validateToolResult,
} from "../models/tool-definitions";
import {
  DEFAULT_TOOL_STATUS_HINT,
  DEFAULT_TOOL_STATUS_MESSAGE,
  getToolStatusConfig,
} from "../models/tool-status";
import type {
  AgentModelOutput,
  ModelAdapter,
  ToolResult,
} from "../models/types";
import type { AgentMessageInput, AgentMessageOutput } from "../schemas/agent";
import {
  CANCEL_WORKFLOW_EVENT_CONFIRM,
  CANCEL_WORKFLOW_EVENT_SELECT_APPOINTMENT,
  RESCHEDULE_WORKFLOW_EVENT_CONFIRM,
  RESCHEDULE_WORKFLOW_EVENT_SELECT_APPOINTMENT,
  RESCHEDULE_WORKFLOW_EVENT_SELECT_SLOT,
  VERIFY_WORKFLOW_EVENT_ZIP,
} from "../workflows/constants";
import {
  cancelAppointment as cancelAppointmentUseCase,
  rescheduleAppointment as rescheduleAppointmentUseCase,
} from "./appointments";
import { createTicketUseCase } from "./tickets";

type ToolCall = {
  toolName: string;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
};

type ModelCall = {
  modelName: string;
  modelId?: string;
  kind: "decide" | "respond" | "status";
  latencyMs: number;
  success: boolean;
  errorCode?: string;
};

type AgentStatusUpdate = {
  text: string;
  toolName: AgentToolName;
  source: "model" | "input_processing" | "routing" | "workflow";
};

type AgentMessageOptions = {
  onStatus?: (status: AgentStatusUpdate) => void;
  onToken?: (token: string) => void;
};

const statusMessageForTool = (toolName: AgentToolName) =>
  getToolStatusConfig(toolName).fallback ?? DEFAULT_TOOL_STATUS_MESSAGE;

const statusHintForTool = (toolName: AgentToolName) =>
  getToolStatusConfig(toolName).statusHint ?? DEFAULT_TOOL_STATUS_HINT;

const logModelCall = (logger: Logger, record: ModelCall) => {
  logger.debug({ modelCall: record }, "agent.model_call");
};

const logToolCall = (logger: Logger, record: ToolCall) => {
  logger.debug({ toolCall: record }, "agent.tool_call");
};

const recordToolCall = async <T>(
  toolName: string,
  call: () => Promise<T>,
): Promise<{ result: T; record: ToolCall }> => {
  const start = Date.now();
  try {
    const result = await call();
    return {
      result,
      record: {
        toolName,
        latencyMs: Date.now() - start,
        success: true,
      },
    };
  } catch (error) {
    return {
      result: error as T,
      record: {
        toolName,
        latencyMs: Date.now() - start,
        success: false,
        errorCode: error instanceof Error ? error.message : "unknown",
      },
    };
  }
};

const recordModelCall = async <T>(
  model: { name: string; modelId?: string },
  kind: ModelCall["kind"],
  call: () => Promise<T>,
): Promise<{ result: T; record: ModelCall }> => {
  const start = Date.now();
  try {
    const result = await call();
    return {
      result,
      record: {
        modelName: model.name,
        modelId: model.modelId,
        kind,
        latencyMs: Date.now() - start,
        success: true,
      },
    };
  } catch (error) {
    return {
      result: error as T,
      record: {
        modelName: model.name,
        modelId: model.modelId,
        kind,
        latencyMs: Date.now() - start,
        success: false,
        errorCode: error instanceof Error ? error.message : "unknown",
      },
    };
  }
};

/**
 * Sanitizes model output to remove embedded JSON, function calls, and code blocks.
 * The model sometimes outputs tool call JSON in its response text which should not
 * be shown to customers.
 */
const sanitizeModelOutput = (text: string): string => {
  if (!text) return "";
  const sanitized = text
    // Strip JSON objects that look like function/tool calls
    .replace(/\{[^{}]*"name"\s*:\s*"[^"]*"[^{}]*\}/g, "")
    .replace(/\{[^{}]*"arguments"\s*:\s*[^{}]*\}/g, "")
    .replace(/\{[^{}]*"tool"\s*:\s*"[^"]*"[^{}]*\}/g, "")
    .replace(/\{[^{}]*"function"\s*:\s*"[^"]*"[^{}]*\}/g, "")
    // Strip markdown code blocks
    .replace(/```json[\s\S]*?```/g, "")
    .replace(/```[\s\S]*?```/g, "")
    // Clean up whitespace
    .replace(/\s{2,}/g, " ")
    .trim();
  return sanitized;
};

const buildCustomerContext = (customer: {
  id: string;
  displayName: string;
  phoneE164: string;
  addressSummary: string;
}) => ({
  id: customer.id,
  displayName: customer.displayName,
  phoneE164: customer.phoneE164,
  addressSummary: customer.addressSummary,
});

const upsertAppointmentSnapshot = async (
  deps: Dependencies,
  phoneE164: string,
  appointment: {
    id: string;
    customerId: string;
    addressSummary: string;
    date: string;
    timeWindow: string;
  } | null,
  status: ServiceAppointment["status"] = ServiceAppointmentStatus.Scheduled,
) => {
  if (!appointment) {
    return;
  }
  const nowIso = new Date().toISOString();
  await deps.appointments.upsert({
    id: appointment.id,
    customerId: appointment.customerId,
    phoneE164,
    addressSummary: appointment.addressSummary,
    date: appointment.date,
    timeWindow: appointment.timeWindow,
    status,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
};

type CallSessionSummary = {
  identityStatus?: "unknown" | "pending" | "verified";
  verifiedCustomerId?: string | null;
  pendingCustomerId?: string | null;
  pendingCustomerProfile?: {
    id: string;
    displayName: string;
    phoneE164: string;
    addressSummary: string;
    zipCode?: string | null;
  } | null;
  workflowState?: {
    kind: "verify" | "reschedule" | "cancel";
    step: string;
    instanceId: string;
    appointmentId?: string | null;
    slotId?: string | null;
    lastError?: string | null;
  } | null;
  lastToolName?: string | null;
  lastToolResult?: string | null;
  lastAppointmentId?: string | null;
  lastAppointmentOptions?: Array<{
    id: string;
    date: string;
    timeWindow: string;
    addressSummary: string;
  }> | null;
  lastAvailableSlots?: Array<{
    id: string;
    date: string;
    timeWindow: string;
  }> | null;
  zipAttempts?: number | null;
  callSummary?: string | null;
};

const parseSummary = (summary: string | null, logger: Logger) => {
  if (!summary) {
    return { identityStatus: "unknown" } satisfies CallSessionSummary;
  }
  try {
    const parsed = JSON.parse(summary) as Partial<CallSessionSummary>;
    const workflowState =
      parsed.workflowState &&
      typeof parsed.workflowState.instanceId === "string"
        ? {
            kind:
              parsed.workflowState.kind === "verify" ||
              parsed.workflowState.kind === "cancel"
                ? parsed.workflowState.kind
                : ("reschedule" as const),
            step:
              typeof parsed.workflowState.step === "string"
                ? parsed.workflowState.step
                : "start",
            instanceId: parsed.workflowState.instanceId,
            appointmentId: parsed.workflowState.appointmentId ?? null,
            slotId: parsed.workflowState.slotId ?? null,
            lastError: parsed.workflowState.lastError ?? null,
          }
        : null;
    return {
      identityStatus: parsed.identityStatus ?? "unknown",
      verifiedCustomerId: parsed.verifiedCustomerId ?? null,
      pendingCustomerId: parsed.pendingCustomerId ?? null,
      pendingCustomerProfile: parsed.pendingCustomerProfile ?? null,
      workflowState,
      lastToolName: parsed.lastToolName ?? null,
      lastToolResult: parsed.lastToolResult ?? null,
      lastAppointmentId: parsed.lastAppointmentId ?? null,
      lastAppointmentOptions: Array.isArray(parsed.lastAppointmentOptions)
        ? (parsed.lastAppointmentOptions as Array<{
            id: string;
            date: string;
            timeWindow: string;
            addressSummary: string;
          }>)
        : null,
      lastAvailableSlots: Array.isArray(parsed.lastAvailableSlots)
        ? (parsed.lastAvailableSlots as Array<{
            id: string;
            date: string;
            timeWindow: string;
          }>)
        : null,
      zipAttempts: parsed.zipAttempts ?? 0,
      callSummary: parsed.callSummary ?? null,
    };
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : "unknown",
        summary: summary.slice(0, 240),
      },
      "agent.summary.parse_failed",
    );
    return { identityStatus: "unknown" } satisfies CallSessionSummary;
  }
};

const buildSummary = (summary: CallSessionSummary) =>
  JSON.stringify({
    identityStatus: summary.identityStatus ?? "unknown",
    verifiedCustomerId: summary.verifiedCustomerId ?? null,
    pendingCustomerId: summary.pendingCustomerId ?? null,
    pendingCustomerProfile: summary.pendingCustomerProfile ?? null,
    workflowState: summary.workflowState ?? null,
    lastToolName: summary.lastToolName ?? null,
    lastToolResult: summary.lastToolResult ?? null,
    lastAppointmentId: summary.lastAppointmentId ?? null,
    lastAppointmentOptions: summary.lastAppointmentOptions ?? null,
    lastAvailableSlots: summary.lastAvailableSlots ?? null,
    zipAttempts: summary.zipAttempts ?? 0,
    callSummary: summary.callSummary ?? null,
  });

const trimSummaryText = (text: string) => {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
};

const stringifyToolResult = (result: ToolResult, logger: Logger) => {
  try {
    const text = JSON.stringify(result);
    return text.length > 800 ? `${text.slice(0, 800)}…` : text;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "unknown" },
      "agent.tool.result.stringify_failed",
    );
    return null;
  }
};

const getStringArg = (args: Record<string, unknown>, key: string) => {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
};

const getNumberArg = (args: Record<string, unknown>, key: string) => {
  const value = args[key];
  return typeof value === "number" ? value : undefined;
};

const interpretConfirmation = async (
  model: ModelAdapter,
  inputText: string,
): Promise<boolean | null> => {
  const options = [
    { id: "confirm", label: "Yes, confirm" },
    { id: "decline", label: "No, do not change it" },
  ];
  const selection = await model.selectOption({
    text: inputText,
    options,
    kind: "confirmation",
  });
  if (selection.selectedId === "confirm") {
    return true;
  }
  if (selection.selectedId === "decline") {
    return false;
  }
  return null;
};

const redactToolResultForPrompt = (toolResult: ToolResult): ToolResult => {
  switch (toolResult.toolName) {
    case "crm.lookupCustomerByPhone":
    case "crm.lookupCustomerByNameAndZip":
    case "crm.lookupCustomerByEmail":
      return {
        toolName: toolResult.toolName,
        result: toolResult.result.map((match) => ({
          id: match.id,
          displayName: match.displayName,
          phoneE164: match.phoneE164,
          addressSummary: match.addressSummary,
        })),
      };
    case "crm.getNextAppointment":
    case "crm.getAppointmentById":
      return {
        toolName: toolResult.toolName,
        result: toolResult.result
          ? {
              date: toolResult.result.date,
              timeWindow: toolResult.result.timeWindow,
              addressSummary: toolResult.result.addressSummary,
              ...(toolResult.result.addressId
                ? { addressId: toolResult.result.addressId }
                : {}),
            }
          : null,
      };
    case "crm.listUpcomingAppointments":
      return {
        toolName: toolResult.toolName,
        result: toolResult.result.map((appointment) => ({
          id: appointment.id,
          customerId: appointment.customerId,
          ...(appointment.addressId
            ? { addressId: appointment.addressId }
            : {}),
          date: appointment.date,
          timeWindow: appointment.timeWindow,
          addressSummary: appointment.addressSummary,
        })),
      };
    case "crm.getAvailableSlots":
      return {
        toolName: toolResult.toolName,
        result: toolResult.result.map((slot) => ({
          date: slot.date,
          timeWindow: slot.timeWindow,
        })),
      };
    default:
      return toolResult;
  }
};

const formatWorkflowOptions = (
  options?: Array<{ id: string; label: string }>,
) =>
  options?.length
    ? options.map((option, index) => `${index + 1}) ${option.label}`).join(" ")
    : "";

const workflowPromptToText = (prompt: {
  kind: "select_appointment" | "select_slot" | "confirm" | "status";
  details?: string;
  options?: Array<{ id: string; label: string }>;
}) => {
  switch (prompt.kind) {
    case "select_appointment": {
      const options = formatWorkflowOptions(prompt.options);
      const count = prompt.options?.length ?? 0;
      return options
        ? `I found ${count} upcoming appointments. Which one should I reschedule? ${options}`
        : "Which appointment should I reschedule?";
    }
    case "select_slot": {
      const options = formatWorkflowOptions(prompt.options);
      return options
        ? `Which time works best? ${options}`
        : "Which time works best for you?";
    }
    case "confirm":
      return (
        prompt.details ??
        "Does that new appointment time look right? Please confirm or decline."
      );
    default:
      return prompt.details ?? "Working on that now.";
  }
};

const buildVerificationPrompt = (
  config: { greeting: string; scopeMessage: string },
  input: {
    includeGreeting: boolean;
    zipAttempts: number;
    invalidZip: boolean;
  },
) => {
  const baseRequest = input.invalidZip
    ? "That ZIP does not match our records. Could you share the 5-digit ZIP code on the account?"
    : input.zipAttempts > 0
      ? "That ZIP does not match our records. Could you share the 5-digit ZIP code on the account?"
      : "Thanks for reaching out. Can you share the 5-digit ZIP code on your account so I can pull up your details?";
  if (!input.includeGreeting) {
    return baseRequest;
  }
  const scopeMessage = config.scopeMessage.trim();
  const intro = scopeMessage
    ? `${config.greeting} ${scopeMessage}`
    : config.greeting;
  return `${intro} ${baseRequest}`;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const formatSlotChoices = (
  slots: Array<{ date: string; timeWindow: string }>,
) => {
  return slots
    .slice(0, 3)
    .map(
      (slot, index) =>
        `${index + 1}) ${formatDateForSpeech(slot.date)} ${formatTimeWindowForSpeech(
          slot.timeWindow,
        )}`,
    )
    .join(" ");
};

const formatDateForSpeech = (dateValue: string) => {
  const [yearRaw, monthRaw, dayRaw] = dateValue.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  const day = Number(dayRaw);
  if (!year || Number.isNaN(monthIndex) || !day) {
    return dateValue;
  }
  const date = new Date(Date.UTC(year, monthIndex, day));
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const month = date.toLocaleDateString("en-US", { month: "long" });
  const suffix =
    day % 10 === 1 && day % 100 !== 11
      ? "st"
      : day % 10 === 2 && day % 100 !== 12
        ? "nd"
        : day % 10 === 3 && day % 100 !== 13
          ? "rd"
          : "th";
  return `${weekday}, ${month} ${day}${suffix}`;
};

const formatTimeForSpeech = (timeValue: string) => {
  const [hourRaw, minuteRaw] = timeValue.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return timeValue;
  }
  const period = hour >= 12 ? "PM" : "AM";
  const adjustedHour = ((hour + 11) % 12) + 1;
  const minuteValue = minute.toString().padStart(2, "0");
  return `${adjustedHour}:${minuteValue} ${period}`;
};

const formatTimeWindowForSpeech = (timeWindow: string) => {
  const [start, end] = timeWindow.split("-");
  if (!start || !end) {
    return timeWindow;
  }
  return `${formatTimeForSpeech(start)} to ${formatTimeForSpeech(end)}`;
};

const getMissingArgsDetails = (
  toolName: AgentToolName,
  summary: CallSessionSummary,
) => {
  if (toolName === "crm.rescheduleAppointment") {
    if (summary.lastAvailableSlots?.length) {
      return `Which slot should I book? ${formatSlotChoices(summary.lastAvailableSlots)}.`;
    }
    return "Which appointment and time should I reschedule? If you want, I can look up your next appointment.";
  }
  return toolName in toolDefinitions
    ? toolDefinitions[toolName as keyof typeof toolDefinitions]
        .missingArgsMessage
    : "Missing or invalid tool arguments.";
};

const zipCodeSchema = z.string().regex(/^\d{5}$/);

const generateReply = async (
  model: ModelAdapter,
  input: AgentMessageInput,
  customer: {
    id: string;
    displayName: string;
    phoneE164: string;
    addressSummary: string;
  },
  toolResult: ToolResult,
  fallbackText: string,
  context: string,
  modelCalls: ModelCall[],
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  logger: Logger,
  callSessionId: string,
  onToken?: (token: string) => void,
) => {
  logger.debug(
    {
      callSessionId,
      toolName: toolResult.toolName,
    },
    "agent.reply.start",
  );
  const respondInput = {
    text: input.text,
    customer: buildCustomerContext(customer),
    messages,
    context,
    hasContext: messages.length > 1,
    ...redactToolResultForPrompt(toolResult),
  };
  const responseCall = await recordModelCall(model, "respond", async () => {
    if (onToken && model.respondStream) {
      let aggregated = "";
      for await (const token of model.respondStream(respondInput)) {
        aggregated += token;
        onToken(token);
      }
      return aggregated;
    }
    return model.respond(respondInput);
  });
  modelCalls.push(responseCall.record);
  logModelCall(logger, responseCall.record);

  if (responseCall.record.success) {
    const text =
      typeof responseCall.result === "string" ? responseCall.result : "";
    // Sanitize to remove any embedded JSON/function calls the model may have outputted
    const sanitized = sanitizeModelOutput(text);
    if (!sanitized) {
      return fallbackText;
    }
    return sanitized;
  }

  logger.info(
    {
      callSessionId,
      errorCode: responseCall.record.errorCode ?? "unknown",
      toolName: toolResult.toolName,
    },
    "agent.reply.failed",
  );
  return fallbackText;
};

export const handleAgentMessage = async (
  deps: Dependencies,
  input: AgentMessageInput,
  nowIso = new Date().toISOString(),
  options?: AgentMessageOptions,
): Promise<AgentMessageOutput> => {
  const phoneE164 = normalizePhoneE164(input.phoneNumber);
  const tools: ToolCall[] = [];
  const modelCalls: ModelCall[] = [];
  const agentConfig = await deps.agentConfig.get(deps.agentConfigDefaults);
  const model = deps.modelFactory(agentConfig);
  let logger = deps.logger;

  logger.info(
    {
      callSessionId: input.callSessionId ?? "new",
      modelId: agentConfig.modelId,
      configUpdatedAt: agentConfig.updatedAt ?? null,
      defaultsModelId: deps.agentConfigDefaults.modelId ?? null,
      inputText: input.text,
    },
    "agent.config.loaded",
  );
  logger.debug(
    {
      callSessionId: input.callSessionId ?? "new",
      phoneE164,
      hasCallSessionId: Boolean(input.callSessionId),
    },
    "agent.request.received",
  );

  let callSessionId = input.callSessionId;
  let contextTurns = 0;
  let recentTurns: Array<{
    speaker: string;
    text: string;
    meta?: Record<string, unknown>;
  }> = [];
  let summary: CallSessionSummary = { identityStatus: "unknown" };
  let session: Awaited<ReturnType<typeof deps.calls.getSession>> | null = null;
  if (!callSessionId) {
    callSessionId = crypto.randomUUID();
    await deps.calls.createSession({
      id: callSessionId,
      startedAt: nowIso,
      phoneE164,
      status: "active",
      transport: "web",
      summary: buildSummary(summary),
    });
  } else {
    session = await deps.calls.getSession(callSessionId);
    if (!session) {
      await deps.calls.createSession({
        id: callSessionId,
        startedAt: nowIso,
        phoneE164,
        status: "active",
        transport: "web",
        summary: buildSummary(summary),
      });
    } else {
      summary = parseSummary(session.summary ?? null, deps.logger);
      recentTurns = await deps.calls.getRecentTurns({ callSessionId });
      contextTurns = recentTurns.filter((turn) => {
        const kind = (turn.meta as { kind?: string } | undefined)?.kind;
        return turn.speaker !== "system" && kind !== "status";
      }).length;
    }
  }

  logger = logger.child({
    callSessionId,
  });

  const updateCallSummary = async (callSummaryText: string) => {
    const latestSession = await deps.calls.getSession(callSessionId);
    const latestSummary = parseSummary(
      latestSession?.summary ?? null,
      deps.logger,
    );
    summary = {
      ...latestSummary,
      callSummary: trimSummaryText(callSummaryText),
    };
    await deps.calls.updateSessionSummary({
      callSessionId,
      summary: buildSummary(summary),
    });
    logger.debug(
      {
        callSessionId,
        callSummary: summary.callSummary ?? null,
        identityStatus: summary.identityStatus ?? null,
        workflowState: summary.workflowState ?? null,
      },
      "agent.summary.updated",
    );
  };

  await deps.calls.addTurn({
    id: crypto.randomUUID(),
    callSessionId,
    ts: nowIso,
    speaker: "caller",
    text: input.text,
    meta: {},
  });

  const lookup = await recordToolCall("crm.lookupCustomerByPhone", () =>
    deps.crm.lookupCustomerByPhone(phoneE164),
  );
  tools.push(lookup.record);
  logToolCall(logger, lookup.record);

  const matches = Array.isArray(lookup.result) ? lookup.result : [];
  if (
    summary.identityStatus !== "verified" &&
    !summary.pendingCustomerId &&
    matches.length === 1 &&
    matches[0]
  ) {
    summary = {
      ...summary,
      identityStatus: "pending",
      pendingCustomerId: matches[0].id,
      pendingCustomerProfile: {
        id: matches[0].id,
        displayName: matches[0].displayName,
        phoneE164: matches[0].phoneE164,
        addressSummary: matches[0].addressSummary,
        zipCode: matches[0].zipCode ?? null,
      },
    };
    await deps.calls.updateSessionSummary({
      callSessionId,
      summary: buildSummary(summary),
    });
  }
  const actions: string[] = [];
  const resolvedCustomer = matches.length === 1 ? matches[0] : null;
  const verifiedCustomerId =
    summary.identityStatus === "verified"
      ? (summary.verifiedCustomerId ?? session?.customerCacheId ?? null)
      : null;
  const verifiedCustomerProfile =
    summary.identityStatus === "verified"
      ? session?.customer?.id === verifiedCustomerId
        ? session.customer
        : verifiedCustomerId
          ? await deps.customers.get(verifiedCustomerId)
          : null
      : null;
  const verifiedCustomer =
    summary.identityStatus === "verified"
      ? (verifiedCustomerProfile ?? resolvedCustomer)
      : null;
  const customer =
    summary.identityStatus === "verified" && verifiedCustomer
      ? {
          id: verifiedCustomer.id,
          displayName: verifiedCustomer.displayName,
          phoneE164: verifiedCustomer.phoneE164 ?? phoneE164,
          addressSummary: verifiedCustomer.addressSummary ?? "Unknown",
        }
      : {
          id: "unknown",
          displayName: "Unknown caller",
          phoneE164,
          addressSummary: "Unknown",
        };

  const systemContext = [
    "System context:",
    `Identity status: ${summary.identityStatus ?? "unknown"}`,
    summary.verifiedCustomerId
      ? `Verified customer: ${summary.verifiedCustomerId}`
      : "Verified customer: none",
    summary.pendingCustomerId
      ? `Pending customer: ${summary.pendingCustomerId}`
      : "Pending customer: none",
    summary.workflowState
      ? `Workflow state: ${summary.workflowState.kind}:${summary.workflowState.step}`
      : "Workflow state: none",
    `Phone lookup matches: ${matches.length}`,
    summary.lastAppointmentId
      ? `Last appointment id: ${summary.lastAppointmentId}`
      : null,
    summary.lastAvailableSlots?.length
      ? `Last available slots: ${formatSlotChoices(summary.lastAvailableSlots)}`
      : null,
    summary.lastToolName ? `Last tool: ${summary.lastToolName}` : null,
    summary.lastToolResult
      ? `Last tool result: ${summary.lastToolResult}`
      : null,
  ];
  const context = systemContext.filter(Boolean).join("\n");

  logger.debug(
    {
      identityStatus: summary.identityStatus,
      pendingCustomerId: summary.pendingCustomerId,
      verifiedCustomerId: summary.verifiedCustomerId,
      inputText: input.text,
    },
    "agent.message.start",
  );

  const messageHistory: Array<{ role: "user" | "assistant"; content: string }> =
    recentTurns
      .filter((turn) => {
        const kind = (turn.meta as { kind?: string } | undefined)?.kind;
        return turn.speaker !== "system" && kind !== "status";
      })
      .map((turn) => ({
        role: turn.speaker === "agent" ? "assistant" : "user",
        content: turn.text,
      }));
  messageHistory.push({ role: "user", content: input.text });
  logger.debug(
    {
      callSessionId,
      contextTurns,
      messageHistoryCount: messageHistory.length,
      lastUserMessage: input.text,
      summarySnapshot: summary,
    },
    "agent.context.snapshot",
  );

  const summarizeModelOutput = (output: AgentModelOutput) => {
    if (output.type === "tool_call") {
      return {
        type: output.type,
        toolName: output.toolName,
        arguments: output.arguments ?? null,
      };
    }
    return {
      type: output.type,
      text: output.text.slice(0, 400),
    };
  };
  let toolCallSource:
    | "model"
    | "input_processing"
    | "routing"
    | "workflow"
    | null = null;
  let toolCall: AgentModelOutput | null = null;
  let decisionSnapshot: ReturnType<typeof summarizeModelOutput> | null = null;
  let modelOutput: AgentModelOutput | null = null;
  let workflowState = summary.workflowState ?? null;
  let workflowPrompt: {
    kind: "select_appointment" | "select_slot" | "confirm" | "status";
    details?: string;
    options?: Array<{ id: string; label: string }>;
  } | null = null;
  let statusOpen = true;
  const trimmedInput = input.text.trim();
  const isZipInput = zipCodeSchema.safeParse(trimmedInput).success;
  const hasNumericInput = trimmedInput.length > 0 && /\d/.test(trimmedInput);

  const activeCustomerId =
    verifiedCustomerId ??
    summary.verifiedCustomerId ??
    resolvedCustomer?.id ??
    session?.customerCacheId ??
    null;

  if (!toolCall && summary.identityStatus !== "verified") {
    const existingVerifyState =
      workflowState?.kind === "verify" ? workflowState : null;
    logger.debug(
      {
        callSessionId,
        identityStatus: summary.identityStatus ?? null,
        workflowState: summary.workflowState ?? null,
        pendingCustomerId: summary.pendingCustomerId ?? null,
      },
      "agent.verify.state",
    );
    if (existingVerifyState?.step === "escalate") {
      const replyText =
        "I'm going to connect you with a specialist to verify your account.";
      await updateCallSummary(replyText);
      await deps.calls.addTurn({
        id: crypto.randomUUID(),
        callSessionId,
        ts: new Date().toISOString(),
        speaker: "agent",
        text: replyText,
        meta: {
          intent: "final",
          tools,
          modelCalls,
          customerId: resolvedCustomer?.id ?? customer.id,
          contextUsed: Boolean(context),
          contextTurns,
          decisionSnapshot,
          toolCallSource,
          replyTextLength: replyText.length,
          replyTextWasEmpty: !replyText.trim(),
        },
      });
      logger.info(
        {
          callSessionId,
          intent: "final",
          toolCallSource,
          toolCount: tools.length,
          modelCallCount: modelCalls.length,
          replyTextLength: replyText.length,
          replyPreview: replyText.slice(0, 160),
        },
        "agent.message.complete",
      );
      return { callSessionId, replyText, actions };
    }

    const pendingVerificationId =
      summary.pendingCustomerId ??
      summary.pendingCustomerProfile?.id ??
      resolvedCustomer?.id ??
      null;

    const verifyWorkflow = deps.workflows.verify;
    if (!verifyWorkflow) {
      if (isZipInput && pendingVerificationId) {
        toolCall = {
          type: "tool_call",
          toolName: "crm.verifyAccount",
          arguments: {
            customerId: pendingVerificationId,
            zipCode: trimmedInput,
          },
        };
        toolCallSource = "input_processing";
        decisionSnapshot = summarizeModelOutput(toolCall);
      } else if (!pendingVerificationId) {
        const ticket = await createTicketUseCase(deps.tickets, {
          subject: "Verification needed",
          description:
            "Caller could not be verified with phone lookup. Manual verification required.",
          category: TicketCategory.General,
          source: TicketSource.Agent,
          phoneE164,
        });
        actions.push("created_ticket");
        const replyText =
          "I'm having trouble verifying the account. I'll connect you with a specialist.";
        await updateCallSummary(replyText);
        await deps.calls.addTurn({
          id: crypto.randomUUID(),
          callSessionId,
          ts: new Date().toISOString(),
          speaker: "agent",
          text: replyText,
          meta: {
            intent: "final",
            tools,
            modelCalls,
            customerId: resolvedCustomer?.id ?? customer.id,
            contextUsed: Boolean(context),
            contextTurns,
            decisionSnapshot,
            toolCallSource,
            replyTextLength: replyText.length,
            replyTextWasEmpty: !replyText.trim(),
            ticketId: ticket.id,
          },
        });
        logger.info(
          {
            callSessionId,
            intent: "final",
            toolCallSource,
            toolCount: tools.length,
            modelCallCount: modelCalls.length,
            replyTextLength: replyText.length,
            replyPreview: replyText.slice(0, 160),
          },
          "agent.message.complete",
        );
        return { callSessionId, replyText, actions, ticketId: ticket.id };
      } else {
        const replyText = buildVerificationPrompt(
          {
            greeting: agentConfig.greeting,
            scopeMessage: agentConfig.scopeMessage,
          },
          {
            includeGreeting: contextTurns === 0,
            zipAttempts: summary.zipAttempts ?? 0,
            invalidZip: hasNumericInput && !isZipInput,
          },
        );
        await updateCallSummary(replyText);
        await deps.calls.addTurn({
          id: crypto.randomUUID(),
          callSessionId,
          ts: new Date().toISOString(),
          speaker: "agent",
          text: replyText,
          meta: {
            intent: "final",
            tools,
            modelCalls,
            customerId: resolvedCustomer?.id ?? customer.id,
            contextUsed: Boolean(context),
            contextTurns,
            decisionSnapshot,
            toolCallSource,
            replyTextLength: replyText.length,
            replyTextWasEmpty: !replyText.trim(),
          },
        });
        logger.info(
          {
            callSessionId,
            intent: "final",
            toolCallSource,
            toolCount: tools.length,
            modelCallCount: modelCalls.length,
            replyTextLength: replyText.length,
            replyPreview: replyText.slice(0, 160),
          },
          "agent.message.complete",
        );
        return { callSessionId, replyText, actions };
      }
    }

    if (verifyWorkflow) {
      if (!existingVerifyState?.instanceId) {
        const instance = await verifyWorkflow.create({
          params: {
            callSessionId,
            phoneE164,
            intent: "verify",
          },
        });
        workflowState = {
          kind: "verify",
          step: "start",
          instanceId: instance.id,
        };
        summary = { ...summary, workflowState };
        await deps.calls.updateSessionSummary({
          callSessionId,
          summary: buildSummary(summary),
        });
      }

      if (isZipInput) {
        if (workflowState?.kind === "verify" && workflowState.instanceId) {
          const instance = await verifyWorkflow.get(workflowState.instanceId);
          await instance.sendEvent({
            type: VERIFY_WORKFLOW_EVENT_ZIP,
            payload: { zipCode: trimmedInput },
          });
        }
        const waitForVerification = async () => {
          for (let i = 0; i < 6; i += 1) {
            const latest = await deps.calls.getSession(callSessionId);
            const latestSummary = parseSummary(
              latest?.summary ?? null,
              deps.logger,
            );
            if (
              latestSummary.identityStatus === "verified" ||
              latestSummary.workflowState?.step === "escalate"
            ) {
              return latestSummary;
            }
            await sleep(250);
          }
          return null;
        };

        const latestSummary = await waitForVerification();
        if (latestSummary?.identityStatus === "verified") {
          const verifiedId =
            latestSummary.verifiedCustomerId ??
            summary.verifiedCustomerId ??
            resolvedCustomer?.id ??
            null;
          const verifiedProfile = verifiedId
            ? await deps.customers.get(verifiedId)
            : null;
          const verifiedCustomerForReply =
            verifiedProfile ??
            (resolvedCustomer?.id === verifiedId ? resolvedCustomer : null);
          const verifiedCustomerContext = verifiedCustomerForReply
            ? {
                id: verifiedCustomerForReply.id,
                displayName: verifiedCustomerForReply.displayName,
                phoneE164: verifiedCustomerForReply.phoneE164 ?? phoneE164,
                addressSummary:
                  verifiedCustomerForReply.addressSummary ?? "Unknown",
              }
            : customer;
          const replyText = await generateReply(
            model,
            input,
            verifiedCustomerContext,
            {
              toolName: "crm.verifyAccount",
              result: { ok: true },
            },
            agentConfig.scopeMessage,
            context,
            modelCalls,
            messageHistory,
            logger,
            callSessionId,
            options?.onToken,
          );
          await updateCallSummary(replyText);
          await deps.calls.addTurn({
            id: crypto.randomUUID(),
            callSessionId,
            ts: new Date().toISOString(),
            speaker: "agent",
            text: replyText,
            meta: {
              intent: "final",
              tools,
              modelCalls,
              customerId: verifiedId ?? customer.id,
              contextUsed: Boolean(context),
              contextTurns,
              decisionSnapshot,
              toolCallSource,
              replyTextLength: replyText.length,
              replyTextWasEmpty: !replyText.trim(),
            },
          });
          logger.info(
            {
              callSessionId,
              intent: "final",
              toolCallSource,
              toolCount: tools.length,
              modelCallCount: modelCalls.length,
              replyTextLength: replyText.length,
              replyPreview: replyText.slice(0, 160),
            },
            "agent.message.complete",
          );
          return { callSessionId, replyText, actions };
        }

        if (latestSummary?.workflowState?.step === "escalate") {
          const replyText = await generateReply(
            model,
            input,
            customer,
            {
              toolName: "agent.escalate",
              result: { escalated: true },
            },
            agentConfig.scopeMessage,
            context,
            modelCalls,
            messageHistory,
            logger,
            callSessionId,
            options?.onToken,
          );
          await updateCallSummary(replyText);
          await deps.calls.addTurn({
            id: crypto.randomUUID(),
            callSessionId,
            ts: new Date().toISOString(),
            speaker: "agent",
            text: replyText,
            meta: {
              intent: "final",
              tools,
              modelCalls,
              customerId: resolvedCustomer?.id ?? customer.id,
              contextUsed: Boolean(context),
              contextTurns,
              decisionSnapshot,
              toolCallSource,
              replyTextLength: replyText.length,
              replyTextWasEmpty: !replyText.trim(),
            },
          });
          logger.info(
            {
              callSessionId,
              intent: "final",
              toolCallSource,
              toolCount: tools.length,
              modelCallCount: modelCalls.length,
              replyTextLength: replyText.length,
              replyPreview: replyText.slice(0, 160),
            },
            "agent.message.complete",
          );
          return { callSessionId, replyText, actions };
        }

        const statusCall = await recordModelCall(model, "status", () =>
          model.status({
            text: input.text,
            contextHint: "verification",
          }),
        );
        modelCalls.push(statusCall.record);
        logModelCall(logger, statusCall.record);
        // Sanitize model output and use empty fallback (all customer-facing text must be model-generated)
        const rawResult =
          statusCall.record.success && typeof statusCall.result === "string"
            ? statusCall.result
            : "";
        const replyText = sanitizeModelOutput(rawResult) || "";
        await updateCallSummary(replyText);
        await deps.calls.addTurn({
          id: crypto.randomUUID(),
          callSessionId,
          ts: new Date().toISOString(),
          speaker: "agent",
          text: replyText,
          meta: {
            intent: "final",
            tools,
            modelCalls,
            customerId: resolvedCustomer?.id ?? customer.id,
            contextUsed: Boolean(context),
            contextTurns,
            decisionSnapshot,
            toolCallSource,
            replyTextLength: replyText.length,
            replyTextWasEmpty: !replyText.trim(),
          },
        });
        logger.info(
          {
            callSessionId,
            intent: "final",
            toolCallSource,
            toolCount: tools.length,
            modelCallCount: modelCalls.length,
            replyTextLength: replyText.length,
            replyPreview: replyText.slice(0, 160),
          },
          "agent.message.complete",
        );
        return { callSessionId, replyText, actions };
      }
    }

    const replyText = buildVerificationPrompt(
      {
        greeting: agentConfig.greeting,
        scopeMessage: agentConfig.scopeMessage,
      },
      {
        includeGreeting: contextTurns === 0,
        zipAttempts: summary.zipAttempts ?? 0,
        invalidZip: hasNumericInput && !isZipInput,
      },
    );
    await updateCallSummary(replyText);
    await deps.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: new Date().toISOString(),
      speaker: "agent",
      text: replyText,
      meta: {
        intent: "final",
        tools,
        modelCalls,
        customerId: resolvedCustomer?.id ?? customer.id,
        contextUsed: Boolean(context),
        contextTurns,
        decisionSnapshot,
        toolCallSource,
        replyTextLength: replyText.length,
        replyTextWasEmpty: !replyText.trim(),
      },
    });
    logger.info(
      {
        callSessionId,
        intent: "final",
        toolCallSource,
        toolCount: tools.length,
        modelCallCount: modelCalls.length,
        replyTextLength: replyText.length,
        replyPreview: replyText.slice(0, 160),
      },
      "agent.message.complete",
    );
    return { callSessionId, replyText, actions };
  }

  const trySelectOption = async (
    options: Array<{ id: string; label: string }>,
    kind: "appointment" | "slot",
  ) => {
    logger.debug(
      {
        callSessionId,
        kind,
        optionCount: options.length,
      },
      "agent.workflow.select.start",
    );
    const trimmed = input.text.trim();
    const directMatch = options.find((option) => option.id === trimmed);
    if (directMatch) {
      const selection = {
        selectedId: directMatch.id,
        index: options.indexOf(directMatch) + 1,
      };
      logger.debug(
        { callSessionId, kind, selection },
        "agent.workflow.select.direct",
      );
      return selection;
    }
    const selectionCall = await recordModelCall(model, "decide", () =>
      model.selectOption({ text: input.text, options, kind }),
    );
    modelCalls.push(selectionCall.record);
    logModelCall(logger, selectionCall.record);
    if (!selectionCall.record.success) {
      logger.info(
        {
          callSessionId,
          kind,
          errorCode: selectionCall.record.errorCode ?? "unknown",
        },
        "agent.workflow.select.failed",
      );
      return { selectedId: null, index: null };
    }
    logger.debug(
      {
        callSessionId,
        kind,
        selection: selectionCall.result,
      },
      "agent.workflow.select.result",
    );
    return selectionCall.result;
  };

  const activeWorkflowSteps = new Set([
    "start",
    "select_appointment",
    "select_slot",
    "confirm",
  ]);
  const rescheduleWorkflow =
    summary.identityStatus === "verified" &&
    workflowState?.kind === "reschedule" &&
    workflowState.instanceId &&
    activeWorkflowSteps.has(workflowState.step)
      ? workflowState
      : null;
  const sendRescheduleEvent = async (
    type: string,
    payload: Record<string, unknown>,
  ) => {
    if (!deps.workflows.reschedule || !rescheduleWorkflow) {
      return false;
    }
    const instance = await deps.workflows.reschedule.get(
      rescheduleWorkflow.instanceId,
    );
    await instance.sendEvent({ type, payload });
    return true;
  };

  if (
    !toolCall &&
    summary.identityStatus === "verified" &&
    rescheduleWorkflow
  ) {
    toolCallSource = "workflow";
    if (!deps.workflows.reschedule) {
      workflowPrompt = {
        kind: "status",
        details:
          "Rescheduling is temporarily unavailable. Please try again shortly.",
      };
    } else if (rescheduleWorkflow.step === "start") {
      workflowPrompt = {
        kind: "status",
        details: "I'm pulling your upcoming appointments now.",
      };
    } else if (rescheduleWorkflow.step === "select_appointment") {
      const appointmentOptions = summary.lastAppointmentOptions ?? [];
      if (!appointmentOptions.length) {
        workflowPrompt = {
          kind: "status",
          details: "I'm pulling your upcoming appointments now.",
        };
      } else {
        const options = appointmentOptions.map((appointment) => ({
          id: appointment.id,
          label: `${formatDateForSpeech(appointment.date)} from ${formatTimeWindowForSpeech(
            appointment.timeWindow,
          )} at ${appointment.addressSummary}`,
        }));
        const selection = await trySelectOption(options, "appointment");
        if (selection.selectedId) {
          const sent = await sendRescheduleEvent(
            RESCHEDULE_WORKFLOW_EVENT_SELECT_APPOINTMENT,
            { appointmentId: selection.selectedId },
          );
          if (!sent) {
            workflowPrompt = {
              kind: "status",
              details:
                "I couldn't send the selection to the reschedule workflow.",
            };
          } else {
            workflowPrompt = {
              kind: "status",
              details: "Got it. I'll check available time slots next.",
            };
          }
        } else {
          workflowPrompt = {
            kind: "select_appointment",
            options,
          };
        }
      }
    } else if (rescheduleWorkflow.step === "select_slot") {
      const slotOptions = summary.lastAvailableSlots ?? [];
      if (!slotOptions.length) {
        workflowPrompt = {
          kind: "status",
          details: "I'm pulling available time slots now.",
        };
      } else {
        const options = slotOptions.map((slot) => ({
          id: slot.id,
          label: `${formatDateForSpeech(
            slot.date,
          )} from ${formatTimeWindowForSpeech(slot.timeWindow)}`,
        }));
        const selection = await trySelectOption(options, "slot");
        if (selection.selectedId) {
          const sent = await sendRescheduleEvent(
            RESCHEDULE_WORKFLOW_EVENT_SELECT_SLOT,
            { slotId: selection.selectedId },
          );
          if (!sent) {
            workflowPrompt = {
              kind: "status",
              details:
                "I couldn't send the slot choice to the reschedule workflow.",
            };
          } else {
            workflowPrompt = {
              kind: "confirm",
              details: "Confirm the new appointment time? (yes or no)",
            };
          }
        } else {
          workflowPrompt = {
            kind: "select_slot",
            options,
          };
        }
      }
    } else if (rescheduleWorkflow.step === "confirm") {
      const confirmed = await interpretConfirmation(model, input.text);
      if (confirmed === null) {
        workflowPrompt = {
          kind: "confirm",
          details: "Confirm the new appointment time? (yes or no)",
        };
      } else {
        const sent = await sendRescheduleEvent(
          RESCHEDULE_WORKFLOW_EVENT_CONFIRM,
          { confirmed },
        );
        if (!sent) {
          workflowPrompt = {
            kind: "status",
            details:
              "I couldn't confirm the reschedule with the workflow. Please try again.",
          };
        } else {
          workflowPrompt = {
            kind: "status",
            details: confirmed
              ? "Thanks. I'll finalize the reschedule now."
              : "Okay, I won't change the appointment.",
          };
        }
      }
    }
  }

  const cancelWorkflowSteps = new Set([
    "start",
    "select_appointment",
    "confirm",
  ]);
  const cancelWorkflow =
    summary.identityStatus === "verified" &&
    workflowState?.kind === "cancel" &&
    workflowState.instanceId &&
    cancelWorkflowSteps.has(workflowState.step)
      ? workflowState
      : null;
  const sendCancelEvent = async (
    type: string,
    payload: Record<string, unknown>,
  ) => {
    if (!deps.workflows.cancel || !cancelWorkflow) {
      return false;
    }
    const instance = await deps.workflows.cancel.get(cancelWorkflow.instanceId);
    await instance.sendEvent({ type, payload });
    return true;
  };

  if (!toolCall && summary.identityStatus === "verified" && cancelWorkflow) {
    toolCallSource = "workflow";
    if (!deps.workflows.cancel) {
      workflowPrompt = {
        kind: "status",
        details:
          "Cancellation is temporarily unavailable. Please try again shortly.",
      };
    } else if (cancelWorkflow.step === "start") {
      workflowPrompt = {
        kind: "status",
        details: "I'm pulling your upcoming appointments now.",
      };
    } else if (cancelWorkflow.step === "select_appointment") {
      const appointmentOptions = summary.lastAppointmentOptions ?? [];
      if (!appointmentOptions.length) {
        workflowPrompt = {
          kind: "status",
          details: "I'm pulling your upcoming appointments now.",
        };
      } else {
        const options = appointmentOptions.map((appointment) => ({
          id: appointment.id,
          label: `${formatDateForSpeech(appointment.date)} from ${formatTimeWindowForSpeech(
            appointment.timeWindow,
          )} at ${appointment.addressSummary}`,
        }));
        const selection = await trySelectOption(options, "appointment");
        if (selection.selectedId) {
          const sent = await sendCancelEvent(
            CANCEL_WORKFLOW_EVENT_SELECT_APPOINTMENT,
            { appointmentId: selection.selectedId },
          );
          if (!sent) {
            workflowPrompt = {
              kind: "status",
              details: "I couldn't send the selection to the cancel workflow.",
            };
          } else {
            workflowPrompt = {
              kind: "confirm",
              details: "Confirm cancelling this appointment? (yes or no)",
            };
          }
        } else {
          workflowPrompt = {
            kind: "select_appointment",
            options,
          };
        }
      }
    } else if (cancelWorkflow.step === "confirm") {
      const confirmed = await interpretConfirmation(model, input.text);
      if (confirmed === null) {
        workflowPrompt = {
          kind: "confirm",
          details: "Confirm cancelling this appointment? (yes or no)",
        };
      } else {
        const sent = await sendCancelEvent(CANCEL_WORKFLOW_EVENT_CONFIRM, {
          confirmed,
        });
        if (!sent) {
          workflowPrompt = {
            kind: "status",
            details:
              "I couldn't confirm the cancellation with the workflow. Please try again.",
          };
        } else {
          workflowPrompt = {
            kind: "status",
            details: confirmed
              ? "Thanks. I'll cancel that appointment now."
              : "Okay, I won't cancel that appointment.",
          };
        }
      }
    }
  }

  const startRescheduleWorkflow = async (customerId: string) => {
    if (!deps.workflows.reschedule) {
      workflowPrompt = {
        kind: "status",
        details:
          "Rescheduling is temporarily unavailable. Please try again shortly.",
      };
      return null;
    }
    const instance = await deps.workflows.reschedule.create({
      params: {
        callSessionId,
        customerId,
        intent: "reschedule",
        message: input.text,
        contextSummary: summary.callSummary ?? undefined,
      },
    });
    workflowState = {
      kind: "reschedule",
      step: "start",
      instanceId: instance.id,
      appointmentId: null,
      slotId: null,
    };
    summary = { ...summary, workflowState };
    await deps.calls.updateSessionSummary({
      callSessionId,
      summary: buildSummary(summary),
    });
    workflowPrompt = {
      kind: "status",
      details: "I'm pulling your upcoming appointments now.",
    };
    return workflowState;
  };

  const startCancelWorkflow = async (customerId: string) => {
    if (!deps.workflows.cancel) {
      workflowPrompt = {
        kind: "status",
        details:
          "Cancellation is temporarily unavailable. Please try again shortly.",
      };
      return null;
    }
    const instance = await deps.workflows.cancel.create({
      params: {
        callSessionId,
        customerId,
        intent: "cancel",
        message: input.text,
      },
    });
    workflowState = {
      kind: "cancel",
      step: "start",
      instanceId: instance.id,
      appointmentId: null,
    };
    summary = { ...summary, workflowState };
    await deps.calls.updateSessionSummary({
      callSessionId,
      summary: buildSummary(summary),
    });
    workflowPrompt = {
      kind: "status",
      details: "I'm pulling your upcoming appointments now.",
    };
    return workflowState;
  };

  if (!toolCall) {
    const modelDecision = await recordModelCall(model, "decide", () =>
      model.generate({
        text: input.text,
        customer: buildCustomerContext(customer),
        messages: messageHistory,
        context,
        hasContext: messageHistory.length > 1,
      }),
    );
    modelCalls.push(modelDecision.record);
    logModelCall(logger, modelDecision.record);

    if (!modelDecision.record.success) {
      throw modelDecision.result;
    }

    modelOutput = modelDecision.result;
    decisionSnapshot = summarizeModelOutput(modelOutput);
    logger.debug({ callSessionId, decisionSnapshot }, "agent.decision.result");
    toolCall = modelOutput.type === "tool_call" ? modelOutput : null;
    if (toolCall) {
      toolCallSource = "model";
    }
  }

  if (
    !toolCall &&
    modelOutput?.type === "final" &&
    summary.identityStatus === "verified"
  ) {
    const routeDecision = await recordModelCall(model, "decide", () =>
      model.route({
        text: input.text,
        customer: buildCustomerContext(customer),
        messages: messageHistory,
        context,
        hasContext: messageHistory.length > 1,
      }),
    );
    modelCalls.push(routeDecision.record);
    logModelCall(logger, routeDecision.record);

    if (routeDecision.record.success) {
      logger.debug(
        { callSessionId, routeDecision: routeDecision.result },
        "agent.routing.result",
      );
      const customerId =
        verifiedCustomerId ??
        summary.verifiedCustomerId ??
        resolvedCustomer?.id ??
        session?.customerCacheId ??
        null;
      if (customerId) {
        switch (routeDecision.result.intent) {
          case "appointments":
            toolCall = {
              type: "tool_call",
              toolName: "crm.getNextAppointment",
              arguments: { customerId },
            };
            toolCallSource = "routing";
            break;
          case "reschedule":
            await startRescheduleWorkflow(customerId);
            break;
          case "cancel":
            await startCancelWorkflow(customerId);
            break;
          case "billing":
            toolCall = {
              type: "tool_call",
              toolName: "crm.getOpenInvoices",
              arguments: { customerId },
            };
            toolCallSource = "routing";
            break;
          case "payment":
            toolCall = {
              type: "tool_call",
              toolName: "crm.escalate",
              arguments: {
                reason: "Payment request",
                summary: summary.lastToolResult
                  ? `Customer wants to pay their balance. Last invoice summary: ${summary.lastToolResult}`
                  : "Customer wants to pay their balance.",
                customerId,
              },
            };
            toolCallSource = "routing";
            break;
          case "policy":
            toolCall = {
              type: "tool_call",
              toolName: "crm.getServicePolicy",
              arguments: { topic: routeDecision.result.topic ?? input.text },
            };
            toolCallSource = "routing";
            break;
          default:
            break;
        }
      }
    } else {
      logger.info(
        {
          callSessionId,
          errorCode: routeDecision.record.errorCode ?? "unknown",
        },
        "agent.routing.failed",
      );
    }
  }

  if (toolCall && summary.identityStatus === "verified") {
    if (
      toolCall.type === "tool_call" &&
      toolCall.toolName === "crm.rescheduleAppointment" &&
      activeCustomerId
    ) {
      toolCall = null;
      toolCallSource = "workflow";
      await startRescheduleWorkflow(activeCustomerId);
    }
    if (
      toolCall?.type === "tool_call" &&
      toolCall.toolName === "crm.cancelAppointment" &&
      activeCustomerId
    ) {
      toolCall = null;
      toolCallSource = "workflow";
      await startCancelWorkflow(activeCustomerId);
    }
  }

  const executeToolCall = async (
    toolName: AgentToolName,
    args: Record<string, unknown>,
  ): Promise<{
    toolResult: ToolResult;
    toolCustomer: typeof customer;
    ticketId?: string;
  }> => {
    let toolResult: ToolResult;
    let toolCustomer = customer;
    let ticketId: string | undefined;
    const verificationAllowedTools = new Set([
      "crm.lookupCustomerByPhone",
      "crm.lookupCustomerByNameAndZip",
      "crm.lookupCustomerByEmail",
      "crm.verifyAccount",
      "crm.escalate",
      "agent.escalate",
    ]);

    const blocked =
      summary.identityStatus !== "verified" &&
      !verificationAllowedTools.has(toolName);

    if (blocked) {
      const blockedRecord = {
        toolName,
        latencyMs: 0,
        success: false,
        errorCode: "blocked_unverified",
      };
      tools.push(blockedRecord);
      logToolCall(logger, blockedRecord);
      toolResult = {
        toolName: "agent.message",
        result: {
          kind: "blocked_unverified",
          details: "Please confirm your ZIP code to verify your account.",
        },
      };
    } else {
      const argValidation = validateToolArgs(toolName, args);
      const toolArgs = (argValidation.data ?? {}) as Record<string, unknown>;
      if (!argValidation.ok) {
        toolResult = {
          toolName: "agent.message",
          result: {
            kind: "missing_arguments",
            details: getMissingArgsDetails(toolName, summary),
          },
        };
      } else {
        switch (toolName) {
          case "crm.lookupCustomerByPhone": {
            const phone = getStringArg(toolArgs, "phoneE164") ?? phoneE164;
            const call = await recordToolCall("crm.lookupCustomerByPhone", () =>
              deps.crm.lookupCustomerByPhone(phone),
            );
            tools.push(call.record);
            logToolCall(logger, call.record);
            const result = Array.isArray(call.result) ? call.result : [];
            const candidateId =
              result.length === 1 && result[0] ? result[0].id : null;
            if (summary.identityStatus !== "verified") {
              summary = {
                ...summary,
                identityStatus: "pending",
                pendingCustomerId: candidateId,
                pendingCustomerProfile:
                  candidateId && result[0]
                    ? {
                        id: result[0].id,
                        displayName: result[0].displayName,
                        phoneE164: result[0].phoneE164,
                        addressSummary: result[0].addressSummary,
                        zipCode: result[0].zipCode ?? null,
                      }
                    : null,
              };
              await deps.calls.updateSessionSummary({
                callSessionId,
                summary: buildSummary(summary),
              });
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "request_zip",
                  details:
                    "Please confirm your ZIP code to verify your account.",
                },
              };
              break;
            }
            if (candidateId && result[0]) {
              toolCustomer = result[0];
            }
            toolResult = {
              toolName: "crm.lookupCustomerByPhone",
              result,
            };
            break;
          }
          case "crm.lookupCustomerByNameAndZip": {
            const fullName = getStringArg(toolArgs, "fullName");
            const zipCode = getStringArg(toolArgs, "zipCode");
            if (!fullName || !zipCode) {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "missing_arguments",
                  details:
                    "Full name and ZIP code are required to look up the account.",
                },
              };
              break;
            }
            const call = await recordToolCall(
              "crm.lookupCustomerByNameAndZip",
              () => deps.crm.lookupCustomerByNameAndZip(fullName, zipCode),
            );
            tools.push(call.record);
            logToolCall(logger, call.record);
            const result = Array.isArray(call.result) ? call.result : [];
            const candidateId =
              result.length === 1 && result[0] ? result[0].id : null;
            if (summary.identityStatus !== "verified") {
              summary = {
                ...summary,
                identityStatus: "pending",
                pendingCustomerId: candidateId,
                pendingCustomerProfile:
                  candidateId && result[0]
                    ? {
                        id: result[0].id,
                        displayName: result[0].displayName,
                        phoneE164: result[0].phoneE164,
                        addressSummary: result[0].addressSummary,
                        zipCode: result[0].zipCode ?? null,
                      }
                    : null,
              };
              await deps.calls.updateSessionSummary({
                callSessionId,
                summary: buildSummary(summary),
              });
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "request_zip",
                  details:
                    "Please confirm your ZIP code to verify your account.",
                },
              };
              break;
            }
            toolResult = {
              toolName: "crm.lookupCustomerByNameAndZip",
              result,
            };
            break;
          }
          case "crm.lookupCustomerByEmail": {
            const email = getStringArg(toolArgs, "email");
            if (!email) {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "missing_arguments",
                  details:
                    "An email address is required to look up the account.",
                },
              };
              break;
            }
            const call = await recordToolCall("crm.lookupCustomerByEmail", () =>
              deps.crm.lookupCustomerByEmail(email),
            );
            tools.push(call.record);
            logToolCall(logger, call.record);
            const result = Array.isArray(call.result) ? call.result : [];
            const candidateId =
              result.length === 1 && result[0] ? result[0].id : null;
            if (summary.identityStatus !== "verified") {
              summary = {
                ...summary,
                identityStatus: "pending",
                pendingCustomerId: candidateId,
                pendingCustomerProfile:
                  candidateId && result[0]
                    ? {
                        id: result[0].id,
                        displayName: result[0].displayName,
                        phoneE164: result[0].phoneE164,
                        addressSummary: result[0].addressSummary,
                        zipCode: result[0].zipCode ?? null,
                      }
                    : null,
              };
              await deps.calls.updateSessionSummary({
                callSessionId,
                summary: buildSummary(summary),
              });
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "request_zip",
                  details:
                    "Please confirm your ZIP code to verify your account.",
                },
              };
              break;
            }
            toolResult = {
              toolName: "crm.lookupCustomerByEmail",
              result,
            };
            break;
          }
          case "crm.verifyAccount": {
            const rawCustomerId =
              getStringArg(toolArgs, "customerId") ??
              summary.pendingCustomerId ??
              resolvedCustomer?.id;
            const customerId =
              rawCustomerId && rawCustomerId !== "unknown"
                ? rawCustomerId
                : (summary.pendingCustomerId ?? resolvedCustomer?.id);
            const zipCode = getStringArg(toolArgs, "zipCode");
            const zipValidation = zipCodeSchema.safeParse(zipCode ?? "");
            if (!customerId || !zipCode || !zipValidation.success) {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "missing_arguments",
                  details:
                    "Please provide a 5-digit ZIP code to verify the account.",
                },
              };
              break;
            }
            const call = await recordToolCall("crm.verifyAccount", () =>
              deps.crm.verifyAccount(customerId, zipCode),
            );
            tools.push(call.record);
            logToolCall(logger, call.record);
            const ok = Boolean(call.result);
            const nextZipAttempts = ok ? 0 : (summary.zipAttempts ?? 0) + 1;
            summary = {
              identityStatus: ok ? "verified" : "pending",
              verifiedCustomerId: ok ? customerId : null,
              pendingCustomerId: ok
                ? null
                : (summary.pendingCustomerId ?? customerId),
              pendingCustomerProfile: ok
                ? null
                : summary.pendingCustomerProfile,
              zipAttempts: nextZipAttempts,
            };
            await deps.calls.updateSessionSummary({
              callSessionId,
              summary: buildSummary(summary),
            });
            if (ok) {
              await deps.calls.updateSessionCustomer({
                callSessionId,
                customerCacheId: customerId,
              });
              const profile =
                matches.find((match) => match.id === customerId) ??
                (summary.pendingCustomerProfile?.id === customerId
                  ? summary.pendingCustomerProfile
                  : null);
              if (profile) {
                const existingCustomer = await deps.customers.get(customerId);
                const participantId = existingCustomer?.participantId ?? null;
                await deps.customers.upsert({
                  id: customerId,
                  crmCustomerId: customerId,
                  displayName: profile.displayName,
                  phoneE164: profile.phoneE164 ?? phoneE164,
                  addressSummary: profile.addressSummary ?? null,
                  zipCode: profile.zipCode ?? null,
                  participantId,
                  updatedAt: new Date().toISOString(),
                });
              }
            }
            if (!ok) {
              toolResult =
                nextZipAttempts >= 2
                  ? {
                      toolName: "agent.message",
                      result: {
                        kind: "escalate",
                        details:
                          "The ZIP code does not match our records. Escalate for manual verification.",
                      },
                    }
                  : {
                      toolName: "agent.message",
                      result: {
                        kind: "request_zip",
                        details:
                          "That ZIP does not match our records. Do you have another ZIP code on file?",
                      },
                    };
            } else {
              toolResult = {
                toolName: "crm.verifyAccount",
                result: { ok },
              };
            }
            break;
          }
          case "crm.getNextAppointment": {
            if (summary.identityStatus !== "verified") {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "request_zip",
                  details:
                    "Please confirm your ZIP code to verify your account.",
                },
              };
              break;
            }
            const customerId =
              getStringArg(toolArgs, "customerId") ?? resolvedCustomer?.id;
            if (!customerId) {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "missing_arguments",
                  details: "Customer ID is required to load appointments.",
                },
              };
              break;
            }
            const call = await recordToolCall("crm.getNextAppointment", () =>
              deps.crm.getNextAppointment(customerId),
            );
            tools.push(call.record);
            logToolCall(logger, call.record);
            await upsertAppointmentSnapshot(
              deps,
              phoneE164,
              (call.result ?? null) as {
                id: string;
                customerId: string;
                addressSummary: string;
                date: string;
                timeWindow: string;
              } | null,
            );
            toolResult = {
              toolName: "crm.getNextAppointment",
              result: call.result ?? null,
            };
            break;
          }
          case "crm.listUpcomingAppointments": {
            if (summary.identityStatus !== "verified") {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "request_zip",
                  details:
                    "Please confirm your ZIP code to verify your account.",
                },
              };
              break;
            }
            const customerId =
              getStringArg(toolArgs, "customerId") ?? resolvedCustomer?.id;
            if (!customerId) {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "missing_arguments",
                  details: "Customer ID is required to list appointments.",
                },
              };
              break;
            }
            const limit = getNumberArg(toolArgs, "limit");
            const call = await recordToolCall(
              "crm.listUpcomingAppointments",
              () => deps.crm.listUpcomingAppointments(customerId, limit),
            );
            tools.push(call.record);
            logToolCall(logger, call.record);
            const result = Array.isArray(call.result) ? call.result : [];
            for (const appointment of result) {
              await upsertAppointmentSnapshot(
                deps,
                phoneE164,
                appointment as {
                  id: string;
                  customerId: string;
                  addressSummary: string;
                  date: string;
                  timeWindow: string;
                },
              );
            }
            toolResult = {
              toolName: "crm.listUpcomingAppointments",
              result,
            };
            break;
          }
          case "crm.getAppointmentById": {
            if (summary.identityStatus !== "verified") {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "request_zip",
                  details:
                    "Please confirm your ZIP code to verify your account.",
                },
              };
              break;
            }
            const appointmentId = getStringArg(toolArgs, "appointmentId");
            if (!appointmentId) {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "missing_arguments",
                  details:
                    "Appointment ID is required to load that appointment.",
                },
              };
              break;
            }
            const call = await recordToolCall("crm.getAppointmentById", () =>
              deps.crm.getAppointmentById(appointmentId),
            );
            tools.push(call.record);
            logToolCall(logger, call.record);
            await upsertAppointmentSnapshot(
              deps,
              phoneE164,
              (call.result ?? null) as {
                id: string;
                customerId: string;
                addressSummary: string;
                date: string;
                timeWindow: string;
              } | null,
            );
            toolResult = {
              toolName: "crm.getAppointmentById",
              result: call.result ?? null,
            };
            break;
          }
          case "crm.getOpenInvoices": {
            if (summary.identityStatus !== "verified") {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "request_zip",
                  details:
                    "Please confirm your ZIP code to verify your account.",
                },
              };
              break;
            }
            const customerId =
              getStringArg(toolArgs, "customerId") ?? resolvedCustomer?.id;
            if (!customerId) {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "missing_arguments",
                  details: "Customer ID is required to look up invoices.",
                },
              };
              break;
            }
            const call = await recordToolCall("crm.getOpenInvoices", () =>
              deps.crm.getOpenInvoices(customerId),
            );
            tools.push(call.record);
            logToolCall(logger, call.record);
            const invoices = Array.isArray(call.result) ? call.result : [];
            const balanceCents = invoices.reduce(
              (sum, invoice) => sum + (invoice.balanceCents ?? 0),
              0,
            );
            const balance =
              invoices.find((invoice) => invoice.balance)?.balance ??
              (balanceCents / 100).toFixed(2);
            const currency = invoices.find(
              (invoice) => invoice.currency,
            )?.currency;
            toolResult = {
              toolName: "crm.getOpenInvoices",
              result: {
                balanceCents,
                balance,
                currency,
                invoiceCount: invoices.length,
              },
            };
            break;
          }
          case "crm.getAvailableSlots": {
            if (summary.identityStatus !== "verified") {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "request_zip",
                  details:
                    "Please confirm your ZIP code to verify your account.",
                },
              };
              break;
            }
            const appointmentId = getStringArg(toolArgs, "appointmentId");
            if (appointmentId) {
              selectedAppointmentId = appointmentId;
            }
            const customerId =
              getStringArg(toolArgs, "customerId") ?? resolvedCustomer?.id;
            if (!customerId) {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "missing_arguments",
                  details:
                    "Customer ID is required to look up available slots.",
                },
              };
              break;
            }
            const inputArgs = {
              daysAhead: getNumberArg(toolArgs, "daysAhead"),
              fromDate: getStringArg(toolArgs, "fromDate"),
              toDate: getStringArg(toolArgs, "toDate"),
              preference: getStringArg(toolArgs, "preference") as
                | "morning"
                | "afternoon"
                | "any"
                | undefined,
            };
            const call = await recordToolCall("crm.getAvailableSlots", () =>
              deps.crm.getAvailableSlots(customerId, inputArgs),
            );
            tools.push(call.record);
            logToolCall(logger, call.record);
            const slots = Array.isArray(call.result) ? call.result : [];
            toolResult =
              slots.length > 0
                ? {
                    toolName: "crm.getAvailableSlots",
                    result: slots,
                  }
                : {
                    toolName: "agent.message",
                    result: {
                      kind: "no_slots",
                      details: "No available time slots were found.",
                    },
                  };
            break;
          }
          case "crm.rescheduleAppointment": {
            if (summary.identityStatus !== "verified") {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "request_zip",
                  details:
                    "Please confirm your ZIP code to verify your account.",
                },
              };
              break;
            }
            const appointmentId = getStringArg(toolArgs, "appointmentId");
            const slotId = getStringArg(toolArgs, "slotId");
            if (!appointmentId || !slotId) {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "missing_arguments",
                  details:
                    "Appointment ID and slot ID are required to reschedule.",
                },
              };
              break;
            }
            const call = await recordToolCall("crm.rescheduleAppointment", () =>
              deps.crm.rescheduleAppointment(appointmentId, slotId),
            );
            tools.push(call.record);
            logToolCall(logger, call.record);
            if (call.result && (call.result as { ok?: boolean }).ok) {
              const updated = (
                call.result as {
                  appointment?: { date: string; timeWindow: string };
                }
              ).appointment;
              if (updated) {
                const appointmentSnapshot = (
                  call.result as {
                    appointment?: unknown;
                  }
                )?.appointment
                  ? ((call.result as { appointment: unknown }).appointment as {
                      id: string;
                      customerId: string;
                      addressSummary: string;
                      date: string;
                      timeWindow: string;
                    })
                  : null;
                const existing = await deps.appointments.get(appointmentId);
                if (existing) {
                  await rescheduleAppointmentUseCase(deps.appointments, {
                    appointment: existing,
                    slot: {
                      date: updated.date,
                      timeWindow: updated.timeWindow,
                    },
                  });
                } else {
                  const customerId =
                    appointmentSnapshot?.customerId ??
                    summary.verifiedCustomerId ??
                    summary.pendingCustomerId ??
                    resolvedCustomer?.id ??
                    "unknown";
                  const addressSummary =
                    appointmentSnapshot?.addressSummary ??
                    summary.pendingCustomerProfile?.addressSummary ??
                    resolvedCustomer?.addressSummary ??
                    "Unknown";
                  await rescheduleAppointmentUseCase(deps.appointments, {
                    appointment: {
                      id: appointmentId,
                      customerId,
                      phoneE164,
                      addressSummary,
                      date: appointmentSnapshot?.date ?? updated.date,
                      timeWindow:
                        appointmentSnapshot?.timeWindow ?? updated.timeWindow,
                      status: ServiceAppointmentStatus.Scheduled,
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                    },
                    slot: {
                      date: updated.date,
                      timeWindow: updated.timeWindow,
                    },
                  });
                }
                toolResult = {
                  toolName: "crm.rescheduleAppointment",
                  result: {
                    date: updated.date,
                    timeWindow: updated.timeWindow,
                  },
                };
                break;
              }
            }
            toolResult = {
              toolName: "agent.message",
              result: {
                kind: "reschedule_failed",
                details:
                  "Unable to reschedule with the provided appointment and slot.",
              },
            };
            break;
          }
          case "crm.cancelAppointment": {
            if (summary.identityStatus !== "verified") {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "request_zip",
                  details:
                    "Please confirm your ZIP code to verify your account.",
                },
              };
              break;
            }
            const appointmentId = getStringArg(toolArgs, "appointmentId");
            if (!appointmentId) {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "missing_arguments",
                  details: "Appointment ID is required to cancel.",
                },
              };
              break;
            }
            const call = await recordToolCall("crm.cancelAppointment", () =>
              deps.crm.cancelAppointment(appointmentId),
            );
            tools.push(call.record);
            logToolCall(logger, call.record);
            if (call.result && (call.result as { ok?: boolean }).ok) {
              const appointmentSnapshot = (
                call.result as {
                  appointment?: unknown;
                }
              )?.appointment
                ? ((call.result as { appointment: unknown }).appointment as {
                    id: string;
                    customerId: string;
                    addressSummary: string;
                    date: string;
                    timeWindow: string;
                  })
                : null;
              const existing = await deps.appointments.get(appointmentId);
              if (existing) {
                await cancelAppointmentUseCase(deps.appointments, {
                  appointment: existing,
                });
              } else {
                await upsertAppointmentSnapshot(
                  deps,
                  phoneE164,
                  appointmentSnapshot,
                  ServiceAppointmentStatus.Cancelled,
                );
              }
              toolResult = {
                toolName: "crm.cancelAppointment",
                result: { ok: true },
              };
              break;
            }
            toolResult = {
              toolName: "crm.cancelAppointment",
              result: { ok: false },
            };
            break;
          }
          case "crm.createAppointment": {
            if (summary.identityStatus !== "verified") {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "request_zip",
                  details:
                    "Please confirm your ZIP code to verify your account.",
                },
              };
              break;
            }
            const customerId =
              getStringArg(toolArgs, "customerId") ?? resolvedCustomer?.id;
            const preferredWindow = getStringArg(toolArgs, "preferredWindow");
            if (!customerId || !preferredWindow) {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "missing_arguments",
                  details:
                    "Customer ID and preferred window are required to create an appointment.",
                },
              };
              break;
            }
            const call = await recordToolCall("crm.createAppointment", () =>
              deps.crm.createAppointment({
                customerId,
                preferredWindow,
                notes: getStringArg(toolArgs, "notes"),
                pestType: getStringArg(toolArgs, "pestType"),
              }),
            );
            tools.push(call.record);
            logToolCall(logger, call.record);
            toolResult = {
              toolName: "crm.createAppointment",
              result: {
                ok: Boolean((call.result as { ok?: boolean })?.ok),
                appointmentId: (call.result as { appointmentId?: string })
                  ?.appointmentId,
              },
            };
            break;
          }
          case "crm.getServicePolicy": {
            const topic = getStringArg(toolArgs, "topic");
            if (!topic) {
              toolResult = {
                toolName: "agent.message",
                result: {
                  kind: "missing_arguments",
                  details: "A policy topic is required.",
                },
              };
              break;
            }
            const call = await recordToolCall("crm.getServicePolicy", () =>
              deps.crm.getServicePolicy(topic),
            );
            tools.push(call.record);
            logToolCall(logger, call.record);
            toolResult = {
              toolName: "crm.getServicePolicy",
              result: { text: String(call.result ?? "") },
            };
            break;
          }
          case "crm.escalate":
          case "agent.escalate": {
            const reason =
              getStringArg(toolArgs, "reason") ??
              "Customer requested escalation";
            const summaryText =
              getStringArg(toolArgs, "summary") ??
              getStringArg(toolArgs, "message") ??
              input.text;
            const customerCacheId =
              summary.verifiedCustomerId ??
              summary.pendingCustomerId ??
              undefined;
            const ticket = await createTicketUseCase(deps.tickets, {
              subject: reason,
              description: summaryText,
              category: TicketCategory.General,
              source: TicketSource.Agent,
              phoneE164,
              customerCacheId,
            });
            ticketId = ticket.id;
            actions.push("created_ticket");
            toolResult =
              toolName === "crm.escalate"
                ? {
                    toolName: "crm.escalate",
                    result: { ok: true, ticketId },
                  }
                : {
                    toolName: "agent.escalate",
                    result: { escalated: true },
                  };
            break;
          }
          default: {
            toolResult = {
              toolName: "agent.message",
              result: {
                kind: "fallback",
                details: agentConfig.scopeMessage,
              },
            };
            break;
          }
        }
      }
    }

    if (toolResult.toolName in toolDefinitions) {
      const validation = validateToolResult(
        toolResult.toolName as keyof typeof toolDefinitions,
        (toolResult as { result?: unknown }).result,
      );
      if (!validation.ok) {
        logger.error(
          {
            callSessionId,
            toolName: toolResult.toolName,
          },
          "agent.tool_result_invalid",
        );
        toolResult = {
          toolName: "agent.message",
          result: {
            kind: "tool_result_invalid",
            details:
              "I ran into an issue fetching those details. Could you try again?",
          },
        };
      }
    }

    let lastAppointmentId = summary.lastAppointmentId ?? null;
    let lastAppointmentOptions = summary.lastAppointmentOptions ?? null;
    let lastAvailableSlots = summary.lastAvailableSlots ?? null;
    if (selectedAppointmentId) {
      lastAppointmentId = selectedAppointmentId;
    }
    if (toolResult.toolName === "crm.getNextAppointment") {
      const appointment = toolResult.result as {
        id?: string | null;
        date?: string;
        timeWindow?: string;
        addressSummary?: string;
      } | null;
      if (appointment?.id) {
        lastAppointmentId = appointment.id;
        if (
          appointment.date &&
          appointment.timeWindow &&
          appointment.addressSummary
        ) {
          lastAppointmentOptions = [
            {
              id: appointment.id,
              date: appointment.date,
              timeWindow: appointment.timeWindow,
              addressSummary: appointment.addressSummary,
            },
          ];
        }
      }
    }
    if (toolResult.toolName === "crm.getAppointmentById") {
      const appointment = toolResult.result as {
        id?: string | null;
        date?: string;
        timeWindow?: string;
        addressSummary?: string;
      } | null;
      if (appointment?.id) {
        lastAppointmentId = appointment.id;
        if (
          appointment.date &&
          appointment.timeWindow &&
          appointment.addressSummary
        ) {
          lastAppointmentOptions = [
            {
              id: appointment.id,
              date: appointment.date,
              timeWindow: appointment.timeWindow,
              addressSummary: appointment.addressSummary,
            },
          ];
        }
      }
    }
    if (toolResult.toolName === "crm.listUpcomingAppointments") {
      const list = toolResult.result as Array<{
        id?: string;
        date?: string;
        timeWindow?: string;
        addressSummary?: string;
      }> | null;
      if (list?.length && list[0]?.id) {
        lastAppointmentId = list[0].id;
      }
      if (list?.length) {
        lastAppointmentOptions = list
          .filter(
            (
              appointment,
            ): appointment is {
              id: string;
              date: string;
              timeWindow: string;
              addressSummary: string;
            } =>
              Boolean(
                appointment.id &&
                  appointment.date &&
                  appointment.timeWindow &&
                  appointment.addressSummary,
              ),
          )
          .slice(0, 3);
      }
    }
    if (toolResult.toolName === "crm.getAvailableSlots") {
      const slots = toolResult.result as Array<{
        id: string;
        date: string;
        timeWindow: string;
      }> | null;
      lastAvailableSlots = Array.isArray(slots) ? slots : null;
    }
    if (toolResult.toolName === "crm.rescheduleAppointment") {
      lastAvailableSlots = null;
    }

    const redactedToolResult = redactToolResultForPrompt(toolResult);
    logger.debug(
      {
        callSessionId,
        toolName: toolResult.toolName,
        toolResult: stringifyToolResult(redactedToolResult, deps.logger),
      },
      "agent.tool.result",
    );
    summary = {
      identityStatus: summary.identityStatus,
      verifiedCustomerId: summary.verifiedCustomerId ?? null,
      pendingCustomerId: summary.pendingCustomerId ?? null,
      pendingCustomerProfile: summary.pendingCustomerProfile ?? null,
      workflowState: summary.workflowState ?? null,
      zipAttempts: summary.zipAttempts ?? 0,
      lastToolName: toolResult.toolName,
      lastToolResult: stringifyToolResult(redactedToolResult, deps.logger),
      lastAppointmentId,
      lastAppointmentOptions,
      lastAvailableSlots,
    };
    await deps.calls.updateSessionSummary({
      callSessionId,
      summary: buildSummary(summary),
    });

    return { toolResult, toolCustomer, ticketId };
  };

  if (!toolCall && workflowPrompt) {
    const replyText = workflowPromptToText(workflowPrompt);
    if (options?.onStatus) {
      options.onStatus({
        text: workflowPrompt.details ?? replyText,
        toolName: "agent.fallback",
        source: "workflow",
      });
    }
    statusOpen = false;
    summary = {
      ...summary,
      callSummary: trimSummaryText(replyText),
    };
    await deps.calls.updateSessionSummary({
      callSessionId,
      summary: buildSummary(summary),
    });
    await deps.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: new Date().toISOString(),
      speaker: "agent",
      text: replyText,
      meta: {
        intent: "final",
        tools,
        modelCalls,
        customerId: resolvedCustomer?.id ?? customer.id,
        contextUsed: Boolean(context),
        contextTurns,
        decisionSnapshot,
        toolCallSource,
        replyTextLength: replyText.length,
        replyTextWasEmpty: !replyText.trim(),
      },
    });

    logger.info(
      {
        callSessionId,
        intent: "final",
        toolCallSource,
        toolCount: tools.length,
        modelCallCount: modelCalls.length,
        replyTextLength: replyText.length,
        replyPreview: replyText.slice(0, 160),
      },
      "agent.message.complete",
    );

    return {
      callSessionId,
      replyText,
      actions,
    };
  }

  if (!toolCall && modelOutput?.type === "final") {
    // Sanitize model output to remove any embedded JSON/function calls
    let replyText = sanitizeModelOutput(modelOutput.text);
    if (!replyText) {
      replyText = agentConfig.scopeMessage;
    }
    summary = {
      ...summary,
      callSummary: trimSummaryText(replyText),
    };
    await deps.calls.updateSessionSummary({
      callSessionId,
      summary: buildSummary(summary),
    });
    await deps.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: new Date().toISOString(),
      speaker: "agent",
      text: replyText,
      meta: {
        intent: "final",
        tools,
        modelCalls,
        customerId: resolvedCustomer?.id ?? customer.id,
        contextUsed: Boolean(context),
        contextTurns,
        decisionSnapshot,
        toolCallSource,
        replyTextLength: replyText.length,
        replyTextWasEmpty: !replyText.trim(),
      },
    });

    logger.info(
      {
        callSessionId,
        intent: "final",
        toolCallSource,
        toolCount: tools.length,
        modelCallCount: modelCalls.length,
        replyTextLength: replyText.length,
        replyPreview: replyText.slice(0, 160),
      },
      "agent.message.complete",
    );

    statusOpen = false;
    return {
      callSessionId,
      replyText,
      actions,
    };
  }

  let replyText = "";
  let intent = toolCall?.toolName ?? "final";
  let ticketId: string | undefined;
  let toolCustomer = customer;
  let selectedAppointmentId: string | null = summary.lastAppointmentId ?? null;
  const failureMessage =
    "Something went wrong on my end. Please try again, or I can have someone reach out to you.";
  const maxToolPasses = 10;
  let iterations = 0;

  if (toolCall && toolCall.type === "tool_call" && options?.onStatus) {
    const emitStatus = options.onStatus;
    const toolName = toolCall.toolName;
    const source = toolCallSource ?? "model";
    const hint = statusHintForTool(toolName);
    void recordModelCall(model, "status", () =>
      model.status({
        text: input.text,
        contextHint: hint,
      }),
    )
      .then((statusCall) => {
        modelCalls.push(statusCall.record);
        logModelCall(logger, statusCall.record);
        // Sanitize model output to remove any embedded JSON/function calls
        const rawText =
          statusCall.record.success && typeof statusCall.result === "string"
            ? statusCall.result
            : "";
        const text = sanitizeModelOutput(rawText);
        if (!statusOpen) {
          return;
        }
        const status: AgentStatusUpdate = {
          // Use model-generated text, only fallback if empty
          text: text || statusMessageForTool(toolName),
          toolName,
          source,
        };
        logger.debug(
          {
            callSessionId,
            toolName: status.toolName,
            source: status.source,
            statusText: status.text,
          },
          "agent.status.emit",
        );
        emitStatus(status);
      })
      .catch(() => {
        if (!statusOpen) {
          return;
        }
        const status: AgentStatusUpdate = {
          text: statusMessageForTool(toolName),
          toolName,
          source,
        };
        logger.debug(
          {
            callSessionId,
            toolName: status.toolName,
            source: status.source,
            statusText: status.text,
          },
          "agent.status.emit",
        );
        emitStatus(status);
      });
  }

  while (toolCall && iterations < maxToolPasses) {
    const args = (toolCall.arguments ?? {}) as Record<string, unknown>;
    logger.debug(
      {
        callSessionId,
        toolName: toolCall.toolName,
        argKeys: Object.keys(args),
      },
      "agent.tool.execute",
    );
    const exec = await executeToolCall(toolCall.toolName, args);
    toolCustomer = exec.toolCustomer;
    ticketId = exec.ticketId ?? ticketId;
    intent = toolCall.toolName;

    replyText = await generateReply(
      model,
      input,
      toolCustomer,
      exec.toolResult,
      failureMessage,
      context,
      modelCalls,
      messageHistory,
      logger,
      callSessionId,
      options?.onToken,
    );
    if (!replyText.trim()) {
      replyText = agentConfig.scopeMessage;
    }

    toolCall = null;
    iterations += 1;
  }

  if (!replyText.trim()) {
    replyText = agentConfig.scopeMessage;
  }
  statusOpen = false;
  summary = {
    ...summary,
    callSummary: trimSummaryText(replyText),
  };
  await deps.calls.updateSessionSummary({
    callSessionId,
    summary: buildSummary(summary),
  });

  await deps.calls.addTurn({
    id: crypto.randomUUID(),
    callSessionId,
    ts: new Date().toISOString(),
    speaker: "agent",
    text: replyText,
    meta: {
      intent,
      tools,
      modelCalls,
      ticketId,
      customerId: resolvedCustomer?.id ?? customer.id,
      contextUsed: Boolean(context),
      contextTurns,
      decisionSnapshot,
      toolCallSource,
      replyTextLength: replyText.length,
      replyTextWasEmpty: !replyText.trim(),
    },
  });

  logger.info(
    {
      callSessionId,
      intent,
      toolCallSource,
      toolCount: tools.length,
      modelCallCount: modelCalls.length,
      replyTextLength: replyText.length,
      replyPreview: replyText.slice(0, 160),
    },
    "agent.message.complete",
  );

  return {
    callSessionId,
    replyText,
    actions,
    ticketId,
  };
};

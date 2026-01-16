import { type ServiceAppointment, normalizePhoneE164 } from "@pestcall/core";
import { z } from "zod";
import type { Dependencies } from "../context";
import type { Logger } from "../logger";
import {
  type AgentToolName,
  toolDefinitions,
  validateToolArgs,
  validateToolResult,
} from "../models/tool-definitions";
import type {
  AgentModelOutput,
  ModelAdapter,
  ToolResult,
} from "../models/types";
import type { AgentMessageInput, AgentMessageOutput } from "../schemas/agent";
import { rescheduleAppointment as rescheduleAppointmentUseCase } from "./appointments";
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
  kind: "decide" | "respond";
  latencyMs: number;
  success: boolean;
  errorCode?: string;
};

const logModelCall = (
  logger: Logger,
  callSessionId: string,
  record: ModelCall,
) => {
  logger.debug({ callSessionId, modelCall: record }, "agent.model_call");
};

const logToolCall = (
  logger: Logger,
  callSessionId: string,
  record: ToolCall,
) => {
  logger.debug({ callSessionId, toolCall: record }, "agent.tool_call");
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
  status: ServiceAppointment["status"] = "scheduled",
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
  lastToolName?: string | null;
  lastToolResult?: string | null;
  lastAppointmentId?: string | null;
  lastAvailableSlots?: Array<{
    id: string;
    date: string;
    timeWindow: string;
  }> | null;
  zipAttempts?: number | null;
  callSummary?: string | null;
};

const parseSummary = (summary: string | null) => {
  if (!summary) {
    return { identityStatus: "unknown" } satisfies CallSessionSummary;
  }
  try {
    const parsed = JSON.parse(summary) as CallSessionSummary;
    return {
      identityStatus: parsed.identityStatus ?? "unknown",
      verifiedCustomerId: parsed.verifiedCustomerId ?? null,
      pendingCustomerId: parsed.pendingCustomerId ?? null,
      pendingCustomerProfile: parsed.pendingCustomerProfile ?? null,
      lastToolName: parsed.lastToolName ?? null,
      lastToolResult: parsed.lastToolResult ?? null,
      lastAppointmentId: parsed.lastAppointmentId ?? null,
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
  } catch {
    return { identityStatus: "unknown" } satisfies CallSessionSummary;
  }
};

const buildSummary = (summary: CallSessionSummary) =>
  JSON.stringify({
    identityStatus: summary.identityStatus ?? "unknown",
    verifiedCustomerId: summary.verifiedCustomerId ?? null,
    pendingCustomerId: summary.pendingCustomerId ?? null,
    pendingCustomerProfile: summary.pendingCustomerProfile ?? null,
    lastToolName: summary.lastToolName ?? null,
    lastToolResult: summary.lastToolResult ?? null,
    lastAppointmentId: summary.lastAppointmentId ?? null,
    lastAvailableSlots: summary.lastAvailableSlots ?? null,
    zipAttempts: summary.zipAttempts ?? 0,
    callSummary: summary.callSummary ?? null,
  });

const trimSummaryText = (text: string) => {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
};

const stringifyToolResult = (result: ToolResult) => {
  try {
    const text = JSON.stringify(result);
    return text.length > 800 ? `${text.slice(0, 800)}…` : text;
  } catch {
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

const formatSlotChoices = (
  slots: Array<{ date: string; timeWindow: string }>,
) => {
  return slots
    .slice(0, 3)
    .map((slot, index) => `${index + 1}) ${slot.date} ${slot.timeWindow}`)
    .join(" ");
};

const getMissingArgsDetails = (
  toolName: AgentToolName,
  summary: CallSessionSummary,
) => {
  if (toolName === "crm.rescheduleAppointment") {
    if (summary.lastAvailableSlots?.length) {
      return `Which slot should I book? ${formatSlotChoices(summary.lastAvailableSlots)}. You can say "first" or give the date/time.`;
    }
    return "Which appointment and time should I reschedule? If you want, I can look up your next appointment.";
  }
  return toolName in toolDefinitions
    ? toolDefinitions[toolName as keyof typeof toolDefinitions]
        .missingArgsMessage
    : "Missing or invalid tool arguments.";
};

const hasZipCandidate = (text: string) => /\b\d{4,9}\b/.test(text);
const zipCodeSchema = z.string().regex(/^\d{5}$/);
const hasActionCommitment = (text: string) =>
  /\b(check|look up|lookup|find|fetch|pull up|review|confirm|verify|reschedule|schedule|book)\b/i.test(
    text,
  );

const enforceVerificationLanguage = (
  text: string,
  identityStatus: CallSessionSummary["identityStatus"],
) => {
  if (identityStatus === "verified") {
    return text;
  }
  const hasVerifyClaim =
    /\bverified\b/i.test(text) || /\bverification succeeded\b/i.test(text);
  if (!hasVerifyClaim) {
    return text;
  }
  return "I still need to verify your account with a 5-digit ZIP code before sharing details.";
};

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
) => {
  logger.debug(
    {
      callSessionId,
      toolName: toolResult.toolName,
    },
    "agent.reply.start",
  );
  if (toolResult.toolName === "agent.message") {
    const result = toolResult.result as { kind?: string; details?: string };
    if (
      result.kind === "request_zip" ||
      result.kind === "blocked_unverified" ||
      result.kind === "missing_arguments"
    ) {
      return (
        result.details ??
        "Please provide your 5-digit ZIP code to verify your account."
      );
    }
  }
  if (toolResult.toolName === "crm.verifyAccount") {
    const result = toolResult.result as { ok?: boolean };
    return result.ok
      ? "Verification succeeded. How can I help you today?"
      : "That ZIP does not match our records. Do you have another ZIP code on file?";
  }
  if (toolResult.toolName === "crm.getNextAppointment") {
    const appointment = toolResult.result as {
      date: string;
      timeWindow: string;
      addressSummary: string;
    } | null;
    if (!appointment) {
      return "I couldn't find a scheduled appointment.";
    }
    return `Your next appointment is ${appointment.date} ${appointment.timeWindow} at ${appointment.addressSummary}.`;
  }
  if (toolResult.toolName === "crm.getOpenInvoices") {
    const invoice = toolResult.result as { balanceCents?: number };
    const balanceCents = invoice.balanceCents ?? 0;
    return balanceCents === 0
      ? "You have no outstanding balance."
      : `Your current balance is $${(balanceCents / 100).toFixed(2)}.`;
  }
  if (toolResult.toolName === "crm.getServicePolicy") {
    const policy = toolResult.result as { text?: string };
    if (policy.text?.trim()) {
      return policy.text.trim();
    }
  }
  if (toolResult.toolName === "crm.rescheduleAppointment") {
    const rescheduled = toolResult.result as {
      date: string;
      timeWindow: string;
    };
    return `Your appointment has been rescheduled to ${rescheduled.date} ${rescheduled.timeWindow}.`;
  }
  const responseCall = await recordModelCall(model, "respond", () =>
    model.respond({
      text: input.text,
      customer: buildCustomerContext(customer),
      messages,
      context,
      hasContext: messages.length > 1,
      ...redactToolResultForPrompt(toolResult),
    }),
  );
  modelCalls.push(responseCall.record);
  logModelCall(logger, callSessionId, responseCall.record);

  if (responseCall.record.success) {
    const text =
      typeof responseCall.result === "string" ? responseCall.result : "";
    const trimmed = text.trim();
    if (!trimmed) {
      return fallbackText;
    }
    return trimmed;
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
): Promise<AgentMessageOutput> => {
  const phoneE164 = normalizePhoneE164(input.phoneNumber);
  const tools: ToolCall[] = [];
  const modelCalls: ModelCall[] = [];
  const agentConfig = await deps.agentConfig.get(deps.agentConfigDefaults);
  const model = deps.modelFactory(agentConfig);
  const logger = deps.logger;

  logger.info(
    {
      callSessionId: input.callSessionId ?? "new",
      modelId: agentConfig.modelId,
      configUpdatedAt: agentConfig.updatedAt ?? null,
    },
    "agent.config.loaded",
  );

  let callSessionId = input.callSessionId;
  let contextTurns = 0;
  let recentTurns: Array<{ speaker: string; text: string }> = [];
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
      summary = parseSummary(session.summary ?? null);
      recentTurns = await deps.calls.getRecentTurns({ callSessionId });
      contextTurns = recentTurns.length;
    }
  }

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
  logToolCall(logger, callSessionId, lookup.record);

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
      callSessionId,
      identityStatus: summary.identityStatus,
      pendingCustomerId: summary.pendingCustomerId,
      verifiedCustomerId: summary.verifiedCustomerId,
      inputText: input.text,
    },
    "agent.message.start",
  );

  const messageHistory: Array<{ role: "user" | "assistant"; content: string }> =
    recentTurns.map((turn) => ({
      role: turn.speaker === "agent" ? "assistant" : "user",
      content: turn.text,
    }));
  messageHistory.push({ role: "user", content: input.text });

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
  let toolCallSource: "model" | "input_processing" | "routing" | null = null;
  let toolCall: AgentModelOutput | null = null;
  let decisionSnapshot: ReturnType<typeof summarizeModelOutput> | null = null;
  let modelOutput: AgentModelOutput | null = null;

  if (summary.identityStatus !== "verified" && summary.pendingCustomerId) {
    const zipCandidate = input.text.match(/\b\d{5}\b/)?.[0] ?? null;
    const zipValidation = zipCodeSchema.safeParse(zipCandidate ?? "");
    if (zipValidation.success) {
      logger.debug(
        {
          callSessionId,
          pendingCustomerId: summary.pendingCustomerId,
          zipProvided: zipCandidate ? `***${zipCandidate.slice(-2)}` : null,
        },
        "agent.input_processing.verify",
      );
      toolCall = {
        type: "tool_call",
        toolName: "crm.verifyAccount",
        arguments: {
          customerId: summary.pendingCustomerId,
          zipCode: zipValidation.data,
        },
      };
      toolCallSource = "input_processing";
      decisionSnapshot = summarizeModelOutput(toolCall);
    }
  }

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
    logModelCall(logger, callSessionId, modelDecision.record);

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
    logModelCall(logger, callSessionId, routeDecision.record);

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
          case "billing":
            toolCall = {
              type: "tool_call",
              toolName: "crm.getOpenInvoices",
              arguments: { customerId },
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
      logToolCall(logger, callSessionId, blockedRecord);
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
            logToolCall(logger, callSessionId, call.record);
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
            logToolCall(logger, callSessionId, call.record);
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
            logToolCall(logger, callSessionId, call.record);
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
            logToolCall(logger, callSessionId, call.record);
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
                await deps.customers.upsert({
                  id: customerId,
                  crmCustomerId: customerId,
                  displayName: profile.displayName,
                  phoneE164: profile.phoneE164 ?? phoneE164,
                  addressSummary: profile.addressSummary ?? null,
                  zipCode: profile.zipCode ?? null,
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
            logToolCall(logger, callSessionId, call.record);
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
            logToolCall(logger, callSessionId, call.record);
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
            logToolCall(logger, callSessionId, call.record);
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
            logToolCall(logger, callSessionId, call.record);
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
            logToolCall(logger, callSessionId, call.record);
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
            logToolCall(logger, callSessionId, call.record);
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
                  await upsertAppointmentSnapshot(
                    deps,
                    phoneE164,
                    appointmentSnapshot,
                  );
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
            logToolCall(logger, callSessionId, call.record);
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
            logToolCall(logger, callSessionId, call.record);
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
              category: "general",
              source: "agent",
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
        logger.warn(
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
    let lastAvailableSlots = summary.lastAvailableSlots ?? null;
    if (toolResult.toolName === "crm.getNextAppointment") {
      const appointment = toolResult.result as {
        id?: string | null;
      } | null;
      if (appointment?.id) {
        lastAppointmentId = appointment.id;
      }
    }
    if (toolResult.toolName === "crm.getAppointmentById") {
      const appointment = toolResult.result as {
        id?: string | null;
      } | null;
      if (appointment?.id) {
        lastAppointmentId = appointment.id;
      }
    }
    if (toolResult.toolName === "crm.listUpcomingAppointments") {
      const list = toolResult.result as Array<{ id?: string }> | null;
      if (list?.length && list[0]?.id) {
        lastAppointmentId = list[0].id;
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
        toolResult: stringifyToolResult(redactedToolResult),
      },
      "agent.tool.result",
    );
    summary = {
      identityStatus: summary.identityStatus,
      verifiedCustomerId: summary.verifiedCustomerId ?? null,
      pendingCustomerId: summary.pendingCustomerId ?? null,
      pendingCustomerProfile: summary.pendingCustomerProfile ?? null,
      zipAttempts: summary.zipAttempts ?? 0,
      lastToolName: toolResult.toolName,
      lastToolResult: stringifyToolResult(redactedToolResult),
      lastAppointmentId,
      lastAvailableSlots,
    };
    await deps.calls.updateSessionSummary({
      callSessionId,
      summary: buildSummary(summary),
    });

    return { toolResult, toolCustomer, ticketId };
  };

  if (!toolCall && modelOutput?.type === "final") {
    let replyText =
      summary.identityStatus !== "verified"
        ? hasZipCandidate(input.text)
          ? "Please provide your 5-digit ZIP code to verify your account."
          : "Please confirm your ZIP code to verify your account."
        : enforceVerificationLanguage(modelOutput.text, summary.identityStatus);
    if (
      summary.identityStatus === "verified" &&
      hasActionCommitment(replyText)
    ) {
      replyText = `${agentConfig.scopeMessage} What would you like to do next?`;
    }
    if (!replyText.trim()) {
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
      },
      "agent.message.complete",
    );

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
  const maxToolPasses = 10;
  let iterations = 0;

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
      agentConfig.scopeMessage,
      context,
      modelCalls,
      messageHistory,
      logger,
      callSessionId,
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

import { normalizePhoneE164, type CustomerCache } from "@pestcall/core";
import { z } from "zod";

import { createDependencies } from "../context";
import {
  type ConversationState,
  applyIntent,
  conversationStateSchema,
  initialConversationState,
} from "../conversation/state-machine";
import {
  type SummarySnapshot,
  deriveConversationStateFromSummary,
} from "../conversation/summary-state";
import type { Env } from "../env";
import type { Logger } from "../logger";
import { createLogger } from "../logger";
import { validateToolArgs } from "../models/tool-definitions";
import type {
  ActionPlan,
  ActionPrecondition,
  AgentModelInput,
  AgentResponseInput,
  SelectionOption,
  ToolResult,
} from "../models/types";
import { actionPlanSchema } from "../models/types";
import {
  type AgentMessageInput,
  type AgentMessageOutput,
  agentMessageInputSchema,
} from "../schemas/agent";
import { handleAgentMessage } from "../use-cases/agent";
import {
  createAppointment,
  getAvailableSlots,
  getOpenInvoices,
  getServicePolicy,
  listUpcomingAppointments,
  verifyAccount,
} from "../use-cases/crm";
import {
  CANCEL_WORKFLOW_EVENT_CONFIRM,
  CANCEL_WORKFLOW_EVENT_SELECT_APPOINTMENT,
  RESCHEDULE_WORKFLOW_EVENT_CONFIRM,
  RESCHEDULE_WORKFLOW_EVENT_SELECT_APPOINTMENT,
  RESCHEDULE_WORKFLOW_EVENT_SELECT_SLOT,
} from "../workflows/constants";
import {
  addRealtimeKitParticipant,
  refreshRealtimeKitToken,
  type RealtimeKitTokenPayload,
} from "../realtime-kit";

type ConversationEventType =
  | "token"
  | "status"
  | "final"
  | "error"
  | "resync"
  | "speaking";

type ConversationEvent = {
  id: number;
  type: ConversationEventType;
  text?: string;
  data?: unknown;
  at: string;
};

type SessionState = {
  lastPhoneNumber?: string;
  lastCallSessionId?: string;
  conversation?: ConversationState;
  cancelWorkflowId?: string;
  rescheduleWorkflowId?: string;
  availableSlots?: Array<{ id: string; date: string; timeWindow: string }>;
  pendingIntent?: {
    kind:
      | "appointments"
      | "cancel"
      | "reschedule"
      | "schedule"
      | "billing"
      | "escalate";
    text: string;
  };
};

type ClientMessage =
  | { type: "barge_in" }
  | { type: "resync"; lastEventId?: number }
  | { type: "confirm_cancel"; confirmed: boolean; callSessionId?: string }
  | {
      type: "start_cancel";
      customerId?: string;
      callSessionId?: string;
      message?: string;
    }
  | {
      type: "final_transcript" | "message";
      text?: string;
      phoneNumber?: string;
      callSessionId?: string;
    };

const toolAcknowledgementSchema = z.enum([
  "crm.listUpcomingAppointments",
  "crm.getNextAppointment",
  "crm.cancelAppointment",
  "crm.rescheduleAppointment",
  "crm.getAvailableSlots",
  "crm.createAppointment",
  "crm.getOpenInvoices",
  "crm.getServicePolicy",
]);

type ToolAcknowledgementName = z.infer<typeof toolAcknowledgementSchema>;

const toolAcknowledgements: Record<
  ToolAcknowledgementName,
  { fallback: string; status?: string; contextHint: string }
> = {
  "crm.listUpcomingAppointments": {
    fallback: "Got it. I'm pulling your upcoming appointments now.",
    status: "Loading appointments",
    contextHint:
      "Acknowledge the request and say you're fetching appointments.",
  },
  "crm.getNextAppointment": {
    fallback: "Got it. I'm pulling your upcoming appointment now.",
    status: "Loading appointments",
    contextHint:
      "Acknowledge the request and say you're fetching the next appointment.",
  },
  "crm.cancelAppointment": {
    fallback: "Got it. I can help cancel an appointment.",
    status: "Starting cancellation",
    contextHint:
      "Acknowledge the cancellation request and say you're getting details.",
  },
  "crm.rescheduleAppointment": {
    fallback: "Got it. I can help reschedule an appointment.",
    status: "Starting reschedule",
    contextHint:
      "Acknowledge the reschedule request and say you're getting details.",
  },
  "crm.getAvailableSlots": {
    fallback: "Thanks. I'm checking the next available times.",
    status: "Loading available times",
    contextHint:
      "Acknowledge the request and say you're checking available times.",
  },
  "crm.createAppointment": {
    fallback: "Got it. I'm checking available times for a new appointment.",
    status: "Checking availability",
    contextHint:
      "Acknowledge the scheduling request and say you're checking availability.",
  },
  "crm.getOpenInvoices": {
    fallback: "Sure. Let me check your balance and invoices.",
    status: "Loading billing details",
    contextHint:
      "Acknowledge the billing request and say you're checking invoices.",
  },
  "crm.getServicePolicy": {
    fallback: "Okay. Let me pull the policy details.",
    status: "Loading policy details",
    contextHint: "Acknowledge and say you're pulling the policy details.",
  },
};

const MAX_EVENT_BUFFER = 200;
const FILLER_STATUS_TEXT = "Okay, checking.";
const FILLER_TIMEOUT_MS = 2000;

export class ConversationSession {
  private connections = new Set<WebSocket>();
  private logger: Logger;
  private eventBuffer: ConversationEvent[] = [];
  private lastEventId = 0;
  private speaking = false;
  private sessionState: SessionState = {};
  private activeStreamId = 0;
  private canceledStreamIds = new Set<number>();
  private activeCallSessionId: string | null = null;
  private turnMetrics: {
    callSessionId: string;
    startedAt: number;
    firstTokenAt: number | null;
    firstStatusAt: number | null;
  } | null = null;

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {
    this.logger = createLogger(env);
    this.state.blockConcurrencyWhile(async () => {
      const [events, lastEventId, speaking, sessionState] = await Promise.all([
        this.state.storage.get<ConversationEvent[]>("events"),
        this.state.storage.get<number>("lastEventId"),
        this.state.storage.get<boolean>("speaking"),
        this.state.storage.get<SessionState>("state"),
      ]);
      this.eventBuffer = events ?? [];
      this.lastEventId = lastEventId ?? 0;
      this.speaking = speaking ?? false;
      const parsedState = sessionState?.conversation
        ? conversationStateSchema.safeParse(sessionState.conversation)
        : null;
      this.sessionState = {
        ...sessionState,
        conversation: parsedState?.success
          ? parsedState.data
          : initialConversationState(),
      };
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/message")) {
      return this.handleMessageRequest(request);
    }

    if (request.method === "POST" && url.pathname.endsWith("/resync")) {
      return this.handleResyncRequest(request);
    }

    if (request.method === "POST" && url.pathname.endsWith("/rtk-token")) {
      return this.handleRealtimeTokenRequest(request);
    }

    return new Response("Not found", { status: 404 });
  }

  private handleWebSocket(_request: Request): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    if (!client || !server) {
      return new Response("WebSocket unavailable", { status: 500 });
    }
    server.accept();
    this.connections.add(server);
    server.addEventListener("close", () => {
      this.connections.delete(server);
    });
    server.addEventListener("error", () => {
      this.connections.delete(server);
    });
    server.addEventListener("message", (event) => {
      void this.handleSocketMessage(server, event.data);
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleSocketMessage(
    socket: WebSocket,
    raw: unknown,
  ): Promise<void> {
    const parsed = this.parseClientMessage(raw);
    if (!parsed) {
      this.sendTo(socket, {
        type: "error",
        text: "Invalid message payload.",
      });
      return;
    }

    this.logger.info({ parsed }, `handleSocketMessage: ${parsed.type}`);

    if (parsed.type === "barge_in") {
      await this.handleBargeIn();
      return;
    }

    if (parsed.type === "resync") {
      await this.replayEvents(parsed.lastEventId, socket);
      return;
    }

    if (parsed.type === "confirm_cancel") {
      const result = await this.handleCancelConfirmation(
        parsed.confirmed,
        parsed.callSessionId,
      );
      if (!result.ok) {
        this.sendTo(socket, {
          type: "error",
          text: result.message ?? "Unable to confirm cancellation.",
        });
      }
      return;
    }

    if (parsed.type === "start_cancel") {
      const result = await this.handleCancelStart({
        callSessionId: parsed.callSessionId,
        customerId: parsed.customerId,
        message: parsed.message,
      });
      if (!result.ok) {
        this.sendTo(socket, {
          type: "error",
          text: result.message ?? "Unable to start cancellation.",
        });
      }
      return;
    }

    if (parsed.type === "final_transcript" || parsed.type === "message") {
      const input = this.resolveInput(parsed);
      if (!input) {
        this.sendTo(socket, {
          type: "error",
          text: "Missing phone number or message text.",
        });
        return;
      }
      await this.runMessage(input);
    }
  }

  private parseClientMessage(raw: unknown): ClientMessage | null {
    const text =
      typeof raw === "string"
        ? raw
        : raw instanceof ArrayBuffer
          ? new TextDecoder().decode(raw)
          : null;
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text) as ClientMessage;
    } catch {
      return null;
    }
  }

  private resolveInput(input: {
    text?: string;
    phoneNumber?: string;
    callSessionId?: string;
  }): AgentMessageInput | null {
    const candidate = {
      callSessionId: input.callSessionId ?? this.sessionState.lastCallSessionId,
      phoneNumber: input.phoneNumber ?? this.sessionState.lastPhoneNumber,
      text: input.text ?? "",
    };
    const validated = agentMessageInputSchema.safeParse(candidate);

    this.logger.info({ validated }, "resolveInput");

    return validated.success ? validated.data : null;
  }

  private async handleMessageRequest(request: Request): Promise<Response> {
    const body = (await request.json()) as
      | (Partial<AgentMessageInput> & {
          type?: "confirm_cancel" | "start_cancel";
          confirmed?: boolean;
          callSessionId?: string;
          customerId?: string;
          message?: string;
        })
      | null;

    this.logger.info({ body }, `handleMessageRequest: ${body?.type}`);

    if (body?.type === "confirm_cancel") {
      const confirmed =
        typeof body.confirmed === "boolean" ? body.confirmed : null;
      if (confirmed === null) {
        return Response.json(
          { error: "Missing cancellation confirmation." },
          { status: 400 },
        );
      }
      const result = await this.handleCancelConfirmation(
        confirmed,
        body.callSessionId,
      );
      return Response.json({ ok: result.ok, message: result.message });
    }
    if (body?.type === "start_cancel") {
      const result = await this.handleCancelStart({
        callSessionId: body.callSessionId,
        customerId: body.customerId,
        message: body.message,
      });
      return Response.json({ ok: result.ok, message: result.message });
    }
    const input = this.resolveInput(body ?? {});
    if (!input) {
      return Response.json(
        { error: "Invalid message payload." },
        { status: 400 },
      );
    }
    const response = await this.runMessage(input);
    return Response.json({
      ok: true,
      callSessionId: response.callSessionId,
    });
  }

  private async handleResyncRequest(request: Request): Promise<Response> {
    const body = (await request.json()) as { lastEventId?: number };
    const lastEventId =
      typeof body?.lastEventId === "number" ? body.lastEventId : undefined;
    const events = this.collectEventsAfter(lastEventId);
    return Response.json({
      events,
      speaking: this.speaking,
      latestEventId: this.lastEventId,
      state: this.sessionState.conversation ?? initialConversationState(),
    });
  }

  private async handleRealtimeTokenRequest(
    request: Request,
  ): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const deps = createDependencies(this.env);
    const customerId = this.sessionState.conversation?.verification.customerId;
    if (!customerId) {
      return Response.json(
        { ok: false, error: "Customer verification required." },
        { status: 400 },
      );
    }
    const customer = await deps.customers.get(customerId);
    if (!customer) {
      return Response.json(
        { ok: false, error: "Customer not found." },
        { status: 404 },
      );
    }
    try {
      const token = await this.getRealtimeKitToken(deps, customer);
      return Response.json({ ok: true, ...token });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "RealtimeKit token failed.";
      this.logger.error(
        { error: message, customerId },
        "conversation.session.rtk_token_failed",
      );
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }

  private async getRealtimeKitToken(
    deps: ReturnType<typeof createDependencies>,
    customer: CustomerCache,
  ): Promise<RealtimeKitTokenPayload> {
    let token: RealtimeKitTokenPayload;
    if (customer.participantId) {
      token = await refreshRealtimeKitToken(this.env, customer.participantId);
    } else {
      token = await addRealtimeKitParticipant(this.env, customer);
    }
    const updatedCustomer: CustomerCache = {
      ...customer,
      participantId: token.participantId,
      updatedAt: new Date().toISOString(),
    };
    await deps.customers.upsert(updatedCustomer);
    return token;
  }

  private async runMessage(
    input: AgentMessageInput,
  ): Promise<AgentMessageOutput> {
    const deps = createDependencies(this.env);
    const callSessionId = input.callSessionId ?? crypto.randomUUID();
    this.activeCallSessionId = callSessionId;
    const activeInput: AgentMessageInput = {
      ...input,
      callSessionId,
    };
    const streamId = ++this.activeStreamId;
    this.canceledStreamIds.delete(streamId);
    await this.setSpeaking(true);
    let lastStatus = "";
    this.turnMetrics = {
      callSessionId,
      startedAt: Date.now(),
      firstTokenAt: null,
      firstStatusAt: null,
    };
    let fillerTimer: ReturnType<typeof setTimeout> | null = null;
    let fillerEmitted = false;
    const scheduleFiller = () => {
      if (this.turnMetrics?.firstTokenAt !== null || fillerEmitted) {
        return;
      }
      if (fillerTimer !== null) {
        clearTimeout(fillerTimer);
      }
      fillerTimer = setTimeout(() => {
        fillerTimer = null;
        if (
          this.canceledStreamIds.has(streamId) ||
          this.turnMetrics?.firstTokenAt !== null ||
          fillerEmitted
        ) {
          return;
        }
        fillerEmitted = true;
        this.recordTurnStatus();
        this.emitEvent({ type: "status", text: FILLER_STATUS_TEXT });
      }, FILLER_TIMEOUT_MS);
    };
    scheduleFiller();
    try {
      const verificationResponse = await this.handleVerificationGate(
        activeInput,
        deps,
        streamId,
      );

      if (verificationResponse) {
        this.emitEvent({ type: "final", data: verificationResponse });
        await this.updateSessionState(activeInput, verificationResponse);
        await this.syncConversationState(
          verificationResponse.callSessionId,
          deps,
        );
        await this.recordTurns(deps, activeInput, verificationResponse);
        return verificationResponse;
      }

      // Handle workflow selection
      const selectionResponse = await this.handleWorkflowSelection(
        activeInput,
        deps,
        streamId,
      );
      if (selectionResponse) {
        this.emitEvent({ type: "final", data: selectionResponse });
        await this.updateSessionState(activeInput, selectionResponse);
        await this.syncConversationState(selectionResponse.callSessionId, deps);
        await this.recordTurns(deps, activeInput, selectionResponse);
        return selectionResponse;
      }
      const toolResponse = await this.handleToolCallingFlow(
        activeInput,
        deps,
        streamId,
      );
      if (toolResponse) {
        this.emitEvent({ type: "final", data: toolResponse });
        await this.updateSessionState(activeInput, toolResponse);
        await this.syncConversationState(toolResponse.callSessionId, deps);
        await this.recordTurns(deps, activeInput, toolResponse);
        return toolResponse;
      }
      const response = await handleAgentMessage(deps, input, undefined, {
        onStatus: (status) => {
          const text = status.text.trim();
          if (!text || text === lastStatus) {
            return;
          }
          this.recordTurnStatus();
          lastStatus = text;
          this.emitEvent({ type: "status", text });
        },
        onToken: (token) => {
          if (this.canceledStreamIds.has(streamId)) {
            return;
          }
          this.recordTurnToken();
          this.emitEvent({ type: "token", text: token });
        },
      });
      if (!this.canceledStreamIds.has(streamId)) {
        this.emitEvent({ type: "final", data: response });
        await this.updateSessionState(input, response);
        await this.syncConversationState(response.callSessionId, deps);
      }
      return response;
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "conversation.session.message_failed",
      );
      const fallback: AgentMessageOutput = {
        callSessionId: callSessionId,
        replyText: "Something went wrong. Please try again.",
        actions: [],
      };
      if (!this.canceledStreamIds.has(streamId)) {
        this.emitEvent({ type: "error", text: fallback.replyText });
        this.emitEvent({ type: "final", data: fallback });
        await this.updateSessionState(input, fallback);
      }
      return fallback;
    } finally {
      const metrics = this.turnMetrics;
      const firstTokenMs =
        metrics?.firstTokenAt === null
          ? null
          : metrics.firstTokenAt - (metrics?.startedAt ?? Date.now());
      const firstStatusMs =
        metrics?.firstStatusAt === null
          ? null
          : metrics.firstStatusAt - (metrics?.startedAt ?? Date.now());
      this.logger.info(
        {
          callSessionId,
          first_token_ms: firstTokenMs,
          time_to_status_ms: firstStatusMs,
        },
        "conversation.session.turn.latency",
      );
      this.turnMetrics = null;
      this.activeCallSessionId = null;
      await this.setSpeaking(false);
    }
  }

  private async updateSessionState(
    input: AgentMessageInput,
    response: AgentMessageOutput,
  ) {
    const current =
      this.sessionState.conversation ?? initialConversationState();
    const nextState = current.verification.verified
      ? current
      : response.replyText.toLowerCase().includes("zip")
        ? applyIntent(current, {
            type: "request_verification",
            reason: "missing",
          })
        : current;
    this.sessionState = {
      ...this.sessionState,
      lastPhoneNumber: input.phoneNumber,
      lastCallSessionId: response.callSessionId,
      conversation: nextState,
    };
    await this.state.storage.put("state", this.sessionState);
  }

  private async syncConversationState(
    callSessionId: string,
    deps: ReturnType<typeof createDependencies>,
  ): Promise<void> {
    const session = await deps.calls.getSession(callSessionId);
    if (!session?.summary) {
      return;
    }
    let summary: SummarySnapshot | null = null;
    try {
      summary = JSON.parse(session.summary) as SummarySnapshot;
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "conversation.session.summary.parse_failed",
      );
      return;
    }
    if (!summary) {
      return;
    }

    const next = deriveConversationStateFromSummary(
      this.sessionState.conversation,
      summary,
    );
    const cancelWorkflowId =
      summary.workflowState?.kind === "cancel" &&
      summary.workflowState.instanceId
        ? summary.workflowState.instanceId
        : this.sessionState.cancelWorkflowId;

    this.sessionState = {
      ...this.sessionState,
      conversation: next,
      cancelWorkflowId,
    };
    await this.state.storage.put("state", this.sessionState);
  }

  private async handleCancelConfirmation(
    confirmed: boolean,
    callSessionId?: string,
  ): Promise<{ ok: boolean; message?: string }> {
    const deps = createDependencies(this.env);
    const sessionId = callSessionId ?? this.sessionState.lastCallSessionId;
    if (!sessionId) {
      return { ok: false, message: "No active session found." };
    }
    if (!deps.workflows.cancel) {
      return {
        ok: false,
        message: "Cancellation is temporarily unavailable.",
      };
    }
    const session = await deps.calls.getSession(sessionId);
    if (!session?.summary) {
      return { ok: false, message: "Unable to load cancellation state." };
    }
    let summary: SummarySnapshot | null = null;
    try {
      summary = JSON.parse(session.summary) as SummarySnapshot;
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "conversation.session.summary.parse_failed",
      );
      return { ok: false, message: "Unable to load cancellation state." };
    }
    const workflow = summary?.workflowState;
    const instanceId =
      workflow?.kind === "cancel"
        ? (workflow.instanceId ?? this.sessionState.cancelWorkflowId)
        : this.sessionState.cancelWorkflowId;
    if (!instanceId) {
      return { ok: false, message: "Cancellation workflow not found." };
    }
    const instance = await deps.workflows.cancel.get(instanceId);
    await instance.sendEvent({
      type: CANCEL_WORKFLOW_EVENT_CONFIRM,
      payload: { confirmed },
    });

    const statusText = confirmed
      ? "Thanks. I'll cancel that appointment now."
      : "Okay, I won't cancel that appointment.";
    this.emitEvent({ type: "status", text: statusText });
    const current =
      this.sessionState.conversation ?? initialConversationState();
    this.sessionState = {
      ...this.sessionState,
      conversation: applyIntent(current, {
        type: confirmed ? "cancel_confirmed" : "cancel_declined",
      }),
      cancelWorkflowId: instanceId,
    };
    await this.state.storage.put("state", this.sessionState);
    return { ok: true, message: statusText };
  }

  private async handleCancelStart(input: {
    callSessionId?: string;
    customerId?: string;
    phoneNumber?: string;
    message?: string;
  }): Promise<{
    ok: boolean;
    message?: string;
    appointments?: Array<{
      id: string;
      date: string;
      timeWindow: string;
      addressSummary: string;
    }>;
  }> {
    const deps = createDependencies(this.env);
    const callSessionId =
      input.callSessionId ?? this.sessionState.lastCallSessionId;
    if (!callSessionId) {
      return { ok: false, message: "No active session found." };
    }
    const phoneNumber =
      input.phoneNumber ?? this.sessionState.lastPhoneNumber ?? null;
    if (!phoneNumber) {
      return { ok: false, message: "Phone number is required to cancel." };
    }
    await this.ensureCallSession(deps, callSessionId, phoneNumber);
    if (!deps.workflows.cancel) {
      return {
        ok: false,
        message: "Cancellation is temporarily unavailable.",
      };
    }
    const customerId =
      input.customerId ??
      this.sessionState.conversation?.verification.customerId ??
      null;
    if (!customerId) {
      return {
        ok: false,
        message: "Customer verification is required before cancelling.",
      };
    }
    const instance = await deps.workflows.cancel.create({
      params: {
        callSessionId,
        customerId,
        intent: "cancel",
        message: input.message ?? "Cancel my appointment.",
      },
    });
    const appointments = await listUpcomingAppointments(
      deps.crm,
      customerId,
      3,
    );
    await this.updateAppointmentSummary(
      deps,
      callSessionId,
      phoneNumber,
      appointments,
    );
    this.sessionState = {
      ...this.sessionState,
      cancelWorkflowId: instance.id,
      availableSlots: undefined,
    };
    await this.state.storage.put("state", this.sessionState);
    this.emitEvent({
      type: "status",
      text: "I'm pulling your upcoming appointments now.",
    });
    await this.syncConversationState(callSessionId, deps);
    return { ok: true, message: instance.id, appointments };
  }

  private async handleRescheduleStart(input: {
    callSessionId?: string;
    customerId?: string;
    phoneNumber?: string;
    message?: string;
  }): Promise<{
    ok: boolean;
    message?: string;
    appointments?: Array<{
      id: string;
      date: string;
      timeWindow: string;
      addressSummary: string;
    }>;
  }> {
    const deps = createDependencies(this.env);
    const callSessionId =
      input.callSessionId ?? this.sessionState.lastCallSessionId;
    if (!callSessionId) {
      return { ok: false, message: "No active session found." };
    }
    const phoneNumber =
      input.phoneNumber ?? this.sessionState.lastPhoneNumber ?? null;
    if (!phoneNumber) {
      return { ok: false, message: "Phone number is required to reschedule." };
    }
    await this.ensureCallSession(deps, callSessionId, phoneNumber);
    if (!deps.workflows.reschedule) {
      return {
        ok: false,
        message: "Rescheduling is temporarily unavailable.",
      };
    }
    const customerId =
      input.customerId ??
      this.sessionState.conversation?.verification.customerId ??
      null;
    if (!customerId) {
      return {
        ok: false,
        message: "Customer verification is required before rescheduling.",
      };
    }
    const instance = await deps.workflows.reschedule.create({
      params: {
        callSessionId,
        customerId,
        intent: "reschedule",
        message: input.message ?? "Reschedule my appointment.",
      },
    });
    const appointments = await listUpcomingAppointments(
      deps.crm,
      customerId,
      3,
    );
    await this.updateAppointmentSummary(
      deps,
      callSessionId,
      phoneNumber,
      appointments,
    );
    this.sessionState = {
      ...this.sessionState,
      rescheduleWorkflowId: instance.id,
      availableSlots: undefined,
    };
    await this.state.storage.put("state", this.sessionState);
    this.emitEvent({
      type: "status",
      text: "I'm pulling your upcoming appointments now.",
    });
    await this.syncConversationState(callSessionId, deps);
    return { ok: true, message: instance.id, appointments };
  }

  private async ensureCallSession(
    deps: ReturnType<typeof createDependencies>,
    callSessionId: string,
    phoneNumber: string,
  ): Promise<void> {
    const existing = await deps.calls.getSession(callSessionId);
    if (existing) {
      return;
    }
    const nowIso = new Date().toISOString();
    const phoneE164 = normalizePhoneE164(phoneNumber);
    await deps.calls.createSession({
      id: callSessionId,
      startedAt: nowIso,
      phoneE164,
      status: "active",
      transport: "web",
      summary: null,
    });
  }

  private async recordTurns(
    deps: ReturnType<typeof createDependencies>,
    input: AgentMessageInput,
    response: AgentMessageOutput,
  ): Promise<void> {
    const callSessionId = input.callSessionId ?? response.callSessionId;
    if (!callSessionId) {
      return;
    }
    await this.ensureCallSession(deps, callSessionId, input.phoneNumber);
    const nowIso = new Date().toISOString();
    const userText = input.text.trim();
    if (userText) {
      await deps.calls.addTurn({
        id: crypto.randomUUID(),
        callSessionId,
        ts: nowIso,
        speaker: "customer",
        text: userText,
        meta: {},
      });
    }
    const agentText = response.replyText.trim();
    if (agentText) {
      await deps.calls.addTurn({
        id: crypto.randomUUID(),
        callSessionId,
        ts: nowIso,
        speaker: "agent",
        text: agentText,
        meta: {},
      });
    }
  }

  private async getRecentMessages(
    deps: ReturnType<typeof createDependencies>,
    callSessionId: string,
  ): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    const turns = await deps.calls.getRecentTurns({ callSessionId, limit: 8 });
    return turns
      .map((turn) => {
        const role = (turn.speaker === "agent" ? "assistant" : "user") as
          | "assistant"
          | "user";
        return { role, content: turn.text };
      })
      .filter((turn) => turn.content.trim().length > 0);
  }

  private async updateIdentitySummary(
    deps: ReturnType<typeof createDependencies>,
    callSessionId: string,
    phoneNumber: string,
    customerId: string,
  ): Promise<void> {
    await this.ensureCallSession(deps, callSessionId, phoneNumber);
    const session = await deps.calls.getSession(callSessionId);
    let summary: SummarySnapshot = {};
    if (session?.summary) {
      try {
        summary = JSON.parse(session.summary) as SummarySnapshot;
      } catch (error) {
        this.logger.error(
          { error: error instanceof Error ? error.message : "unknown" },
          "conversation.session.summary.parse_failed",
        );
      }
    }
    const nextSummary: SummarySnapshot = {
      ...summary,
      identityStatus: "verified",
      verifiedCustomerId: customerId,
    };
    await deps.calls.updateSessionSummary({
      callSessionId,
      summary: JSON.stringify(nextSummary),
    });
  }

  private async updateAppointmentSummary(
    deps: ReturnType<typeof createDependencies>,
    callSessionId: string,
    phoneNumber: string,
    appointments: Array<{
      id: string;
      date: string;
      timeWindow: string;
      addressSummary: string;
    }>,
  ): Promise<void> {
    await this.ensureCallSession(deps, callSessionId, phoneNumber);
    const session = await deps.calls.getSession(callSessionId);
    let summary: SummarySnapshot = {};
    if (session?.summary) {
      try {
        summary = JSON.parse(session.summary) as SummarySnapshot;
      } catch (error) {
        this.logger.error(
          { error: error instanceof Error ? error.message : "unknown" },
          "conversation.session.summary.parse_failed",
        );
      }
    }
    const nextSummary: SummarySnapshot = {
      ...summary,
      lastAppointmentOptions: appointments.map((appointment) => ({
        id: appointment.id,
        date: appointment.date,
        timeWindow: appointment.timeWindow,
        addressSummary: appointment.addressSummary,
      })),
    };
    await deps.calls.updateSessionSummary({
      callSessionId,
      summary: JSON.stringify(nextSummary),
    });
  }

  private async handleVerificationGate(
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
    streamId: number,
  ): Promise<AgentMessageOutput | null> {
    const state = this.sessionState.conversation ?? initialConversationState();
    if (state.verification.verified) {
      return null;
    }
    const matches = await deps.crm.lookupCustomerByPhone(input.phoneNumber);
    const customer =
      Array.isArray(matches) && matches.length === 1 ? matches[0] : null;
    const zipMatch = input.text.match(/\b(\d{5})\b/);
    const callSessionId = input.callSessionId ?? crypto.randomUUID();
    if (!zipMatch || !customer) {
      const pendingIntent = this.inferPendingIntent(input.text);
      if (pendingIntent) {
        this.sessionState = {
          ...this.sessionState,
          pendingIntent,
        };
        await this.state.storage.put("state", this.sessionState);
      }
      const replyText = await this.narrateText(
        input,
        deps,
        streamId,
        "To get started, please share the 5-digit ZIP code on your account.",
        "Ask for the 5-digit ZIP code to verify the account.",
      );
      const response: AgentMessageOutput = {
        callSessionId,
        replyText,
        actions: [],
      };
      this.sessionState = {
        ...this.sessionState,
        conversation: applyIntent(state, {
          type: "request_verification",
          reason: "missing",
        }),
      };
      await this.state.storage.put("state", this.sessionState);
      return response;
    }

    const zipCode = zipMatch[1];
    if (!zipCode) {
      const replyText = await this.narrateText(
        input,
        deps,
        streamId,
        "To get started, please share the 5-digit ZIP code on your account.",
        "Ask for the 5-digit ZIP code to verify the account.",
      );
      const response: AgentMessageOutput = {
        callSessionId,
        replyText,
        actions: [],
      };
      return response;
    }
    this.emitEvent({ type: "status", text: "Checking that ZIP code now." });
    const ok = await verifyAccount(deps.crm, customer.id, zipCode);
    if (ok) {
      await this.updateIdentitySummary(
        deps,
        callSessionId,
        input.phoneNumber,
        customer.id,
      );
    }
    const verificationText = ok
      ? "Thanks, you're verified. What would you like to do next?"
      : "That ZIP does not match our records. Please share the 5-digit ZIP code on your account.";
    let followupText: string | null = null;
    if (ok && this.sessionState.pendingIntent) {
      const pending = this.sessionState.pendingIntent;
      this.sessionState = {
        ...this.sessionState,
        pendingIntent: undefined,
      };
      await this.state.storage.put("state", this.sessionState);
      followupText = await this.handlePendingIntent(
        pending,
        {
          ...input,
          callSessionId,
        },
        deps,
        streamId,
      );
    }
    const verificationReply = await this.narrateText(
      input,
      deps,
      streamId,
      verificationText,
      ok
        ? "Thank them, confirm they're verified, and ask what they'd like to do next. Avoid saying 'verification succeeded'."
        : "Explain the ZIP did not match and ask for the correct ZIP in a friendly tone.",
    );
    const response: AgentMessageOutput = {
      callSessionId,
      replyText: followupText
        ? `${verificationReply} ${followupText}`.trim()
        : verificationReply,
      actions: [],
    };
    this.sessionState = {
      ...this.sessionState,
      conversation: ok
        ? applyIntent(state, {
            type: "verified",
            customerId: customer.id,
          })
        : applyIntent(state, {
            type: "request_verification",
            reason: "invalid_zip",
          }),
    };
    await this.state.storage.put("state", this.sessionState);
    return response;
  }

  private inferPendingIntent(
    text: string,
  ): SessionState["pendingIntent"] | null {
    const lowered = text.toLowerCase();
    if (
      this.isScheduleRequest(lowered) ||
      this.isAvailabilityRequest(lowered)
    ) {
      return { kind: "schedule", text };
    }
    if (/\bcancel\b/.test(lowered)) {
      return { kind: "cancel", text };
    }
    if (/\breschedul(e|ing)\b/.test(lowered)) {
      return { kind: "reschedule", text };
    }
    if (/\b(change|move)\b.*\bappointment\b/.test(lowered)) {
      return { kind: "reschedule", text };
    }
    if (
      /\b(appointment|appointments|schedule|scheduled|when)\b/.test(lowered)
    ) {
      return { kind: "appointments", text };
    }
    if (
      /\b(bill|billing|invoice|payment|pay|balance|owe|owed)\b/.test(lowered)
    ) {
      return { kind: "billing", text };
    }
    if (
      /\b(agent|human|representative|manager|supervisor|complaint|escalate)\b/.test(
        lowered,
      )
    ) {
      return { kind: "escalate", text };
    }
    return null;
  }

  private async handlePendingIntent(
    intent: NonNullable<SessionState["pendingIntent"]>,
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
    streamId: number,
  ): Promise<string | null> {
    const callSessionId = input.callSessionId ?? crypto.randomUUID();
    if (!this.sessionState.conversation?.verification.customerId) {
      return null;
    }
    switch (intent.kind) {
      case "appointments": {
        this.emitEvent({
          type: "status",
          text: "Looking up your appointments now.",
        });
        const appointments = await listUpcomingAppointments(
          deps.crm,
          this.sessionState.conversation.verification.customerId,
          3,
        );
        await this.updateAppointmentSummary(
          deps,
          callSessionId,
          input.phoneNumber,
          appointments,
        );
        const replyText = await this.narrateToolResult(
          {
            toolName: "crm.listUpcomingAppointments",
            result: appointments.map((appointment) => ({
              id: appointment.id,
              customerId:
                this.sessionState.conversation?.verification.customerId ?? "",
              date: appointment.date,
              timeWindow: appointment.timeWindow,
              addressSummary: appointment.addressSummary,
            })),
          },
          {
            input,
            deps,
            streamId,
            fallback: appointments.length
              ? this.formatAppointmentsResponse(appointments)
              : "I couldn't find any upcoming appointments. Would you like to schedule one?",
            contextHint: "The customer asked about upcoming appointments.",
          },
        );
        const state =
          this.sessionState.conversation ?? initialConversationState();
        this.sessionState = {
          ...this.sessionState,
          conversation: applyIntent(state, {
            type: "appointments_loaded",
            appointments: appointments.map((appointment) => ({
              id: appointment.id,
              date: appointment.date,
              timeWindow: appointment.timeWindow,
              addressSummary: appointment.addressSummary,
            })),
          }),
        };
        await this.state.storage.put("state", this.sessionState);
        return replyText;
      }
      case "schedule": {
        const customerId =
          this.sessionState.conversation.verification.customerId;
        const slots = await getAvailableSlots(deps.crm, customerId, {
          daysAhead: 14,
        });
        this.sessionState = {
          ...this.sessionState,
          availableSlots: slots.map((slot) => ({
            id: slot.id,
            date: slot.date,
            timeWindow: slot.timeWindow,
          })),
        };
        await this.state.storage.put("state", this.sessionState);
        return await this.narrateToolResult(
          {
            toolName: "crm.getAvailableSlots",
            result: slots.map((slot) => ({
              date: slot.date,
              timeWindow: slot.timeWindow,
            })),
          },
          {
            input,
            deps,
            streamId,
            fallback: slots.length
              ? "Here are the next available times. Is this for the same address we have on file?"
              : "I couldn't find any available times right now. Would you like me to check again later?",
            contextHint:
              "Offer available appointment times and confirm whether the on-file address is correct.",
          },
        );
      }
      case "cancel": {
        const result = await this.handleCancelStart({
          callSessionId,
          customerId: this.sessionState.conversation.verification.customerId,
          phoneNumber: input.phoneNumber,
          message: intent.text,
        });
        if (!result.ok) {
          return result.message ?? "Cancellation is temporarily unavailable.";
        }
        const appointments = result.appointments ?? [];
        return await this.narrateToolResult(
          {
            toolName: "crm.listUpcomingAppointments",
            result: appointments.map((appointment) => ({
              id: appointment.id,
              customerId:
                this.sessionState.conversation?.verification.customerId ?? "",
              date: appointment.date,
              timeWindow: appointment.timeWindow,
              addressSummary: appointment.addressSummary,
            })),
          },
          {
            input,
            deps,
            streamId,
            fallback: appointments.length
              ? this.formatAppointmentsResponse(appointments)
              : "I couldn't find any upcoming appointments to cancel.",
            contextHint: "Ask which appointment to cancel using the list.",
          },
        );
      }
      case "reschedule": {
        const result = await this.handleRescheduleStart({
          callSessionId,
          customerId: this.sessionState.conversation.verification.customerId,
          phoneNumber: input.phoneNumber,
          message: intent.text,
        });
        if (!result.ok) {
          return result.message ?? "Rescheduling is temporarily unavailable.";
        }
        const appointments = result.appointments ?? [];
        return await this.narrateToolResult(
          {
            toolName: "crm.listUpcomingAppointments",
            result: appointments.map((appointment) => ({
              id: appointment.id,
              customerId:
                this.sessionState.conversation?.verification.customerId ?? "",
              date: appointment.date,
              timeWindow: appointment.timeWindow,
              addressSummary: appointment.addressSummary,
            })),
          },
          {
            input,
            deps,
            streamId,
            fallback: appointments.length
              ? this.formatAppointmentsResponse(appointments)
              : "I couldn't find any upcoming appointments to reschedule.",
            contextHint: "Ask which appointment to reschedule using the list.",
          },
        );
      }
      case "billing": {
        const invoices = await getOpenInvoices(
          deps.crm,
          this.sessionState.conversation.verification.customerId,
        );
        const balanceCents = invoices.reduce(
          (sum, invoice) => sum + (invoice.balanceCents ?? 0),
          0,
        );
        const balance =
          invoices.find((invoice) => invoice.balance)?.balance ??
          (balanceCents / 100).toFixed(2);
        const currency = invoices.find((invoice) => invoice.currency)?.currency;
        return await this.narrateToolResult(
          {
            toolName: "crm.getOpenInvoices",
            result: {
              balanceCents,
              balance,
              currency,
              invoiceCount: invoices.length,
            },
          },
          {
            input,
            deps,
            streamId,
            fallback: invoices.length
              ? this.formatInvoicesResponse(invoices)
              : "You're all set. I don't see any open invoices right now.",
            contextHint: "Provide billing balance details.",
          },
        );
      }
      case "escalate": {
        const result = await deps.crm.escalate({
          reason: "customer_request",
          summary: intent.text,
          customerId: this.sessionState.conversation.verification.customerId,
        });
        return result.ok
          ? await this.narrateToolResult(
              {
                toolName: "crm.escalate",
                result: { ok: true, ticketId: result.ticketId },
              },
              {
                input,
                deps,
                streamId,
                fallback: `I've asked a specialist to reach out. Your ticket ID is ${result.ticketId ?? "on file"}.`,
                contextHint:
                  "Confirm that a specialist will follow up and share the ticket id if available.",
              },
            )
          : "I'm sorry, I couldn't start an escalation right now. Please try again in a moment.";
      }
      default:
        return null;
    }
  }

  private async handleWorkflowSelection(
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
    streamId: number,
  ): Promise<AgentMessageOutput | null> {
    const callSessionId =
      input.callSessionId ?? this.sessionState.lastCallSessionId;
    if (!callSessionId) {
      return null;
    }
    if (
      !this.sessionState.cancelWorkflowId &&
      !this.sessionState.rescheduleWorkflowId
    ) {
      return null;
    }
    const text = input.text.trim();
    const confirmationSelection = await this.selectOption(
      input,
      deps,
      "confirmation",
      [
        { id: "confirm", label: "Yes, confirm" },
        { id: "decline", label: "No, do not change it" },
      ],
    );
    const confirmation =
      confirmationSelection === "confirm"
        ? true
        : confirmationSelection === "decline"
          ? false
          : this.parseConfirmation(text);
    const appointmentIdMatch = text.match(/^appt_[\w-]+$/i);
    const slotIdMatch = text.match(/^slot_[\w-]+$/i);
    const appointments =
      this.sessionState.conversation?.appointments ?? ([] as const);
    const appointmentOptions = appointments.map((appointment) => ({
      id: appointment.id,
      label: this.formatAppointmentLabel(appointment),
    }));
    const resolvedAppointmentId =
      appointmentIdMatch?.[0] ??
      (await this.selectOption(
        input,
        deps,
        "appointment",
        appointmentOptions,
      )) ??
      this.resolveAppointmentSelection(text, appointments);
    const availableSlots = this.sessionState.availableSlots ?? [];
    const slotOptions = availableSlots.map((slot) => ({
      id: slot.id,
      label: this.formatSlotLabel(slot),
    }));
    const resolvedSlotId =
      slotIdMatch?.[0] ??
      (await this.selectOption(input, deps, "slot", slotOptions));

    if (this.sessionState.cancelWorkflowId) {
      if (resolvedAppointmentId) {
        const instance = await deps.workflows.cancel?.get(
          this.sessionState.cancelWorkflowId,
        );
        if (instance) {
          await instance.sendEvent({
            type: CANCEL_WORKFLOW_EVENT_SELECT_APPOINTMENT,
            payload: { appointmentId: resolvedAppointmentId },
          });
          const state =
            this.sessionState.conversation ?? initialConversationState();
          this.sessionState = {
            ...this.sessionState,
            conversation: applyIntent(state, {
              type: "cancel_requested",
              appointmentId: resolvedAppointmentId,
            }),
          };
          await this.state.storage.put("state", this.sessionState);
          const replyText = await this.narrateText(
            input,
            deps,
            streamId,
            "Confirm cancelling this appointment?",
            "Ask the customer to confirm cancelling the selected appointment.",
          );
          return {
            callSessionId,
            replyText,
            actions: [],
          };
        }
      }
      if (confirmation !== null) {
        const instance = await deps.workflows.cancel?.get(
          this.sessionState.cancelWorkflowId,
        );
        if (instance) {
          await instance.sendEvent({
            type: CANCEL_WORKFLOW_EVENT_CONFIRM,
            payload: { confirmed: confirmation },
          });
          const state =
            this.sessionState.conversation ?? initialConversationState();
          this.sessionState = {
            ...this.sessionState,
            conversation: applyIntent(state, {
              type: confirmation ? "cancel_confirmed" : "cancel_declined",
            }),
            availableSlots: undefined,
          };
          await this.state.storage.put("state", this.sessionState);
          const replyText = await this.narrateText(
            input,
            deps,
            streamId,
            confirmation
              ? "Thanks. I'll cancel that appointment now."
              : "Okay, I won't cancel that appointment.",
            "Confirm or acknowledge the cancellation decision.",
          );
          return {
            callSessionId,
            replyText,
            actions: [],
          };
        }
      }
      if (appointments.length) {
        const replyText = await this.narrateToolResult(
          {
            toolName: "crm.listUpcomingAppointments",
            result: appointments.map((appointment) => ({
              id: appointment.id,
              customerId:
                this.sessionState.conversation?.verification.customerId ?? "",
              date: appointment.date,
              timeWindow: appointment.timeWindow,
              addressSummary: appointment.addressSummary,
            })),
          },
          {
            input,
            deps,
            streamId,
            fallback: this.formatAppointmentsResponse(appointments),
            contextHint: "Ask which appointment to cancel using the list.",
          },
        );
        return {
          callSessionId,
          replyText,
          actions: [],
        };
      }
    }

    if (this.sessionState.rescheduleWorkflowId) {
      if (resolvedAppointmentId) {
        const instance = await deps.workflows.reschedule?.get(
          this.sessionState.rescheduleWorkflowId,
        );
        if (instance) {
          await instance.sendEvent({
            type: RESCHEDULE_WORKFLOW_EVENT_SELECT_APPOINTMENT,
            payload: { appointmentId: resolvedAppointmentId },
          });
          const customerId =
            this.sessionState.conversation?.verification.customerId ?? null;
          const slots = customerId
            ? await getAvailableSlots(deps.crm, customerId, {
                daysAhead: 14,
              })
            : [];
          this.sessionState = {
            ...this.sessionState,
            availableSlots: slots.map((slot) => ({
              id: slot.id,
              date: slot.date,
              timeWindow: slot.timeWindow,
            })),
          };
          await this.state.storage.put("state", this.sessionState);
          const replyText = await this.narrateToolResult(
            {
              toolName: "crm.getAvailableSlots",
              result: slots.map((slot) => ({
                date: slot.date,
                timeWindow: slot.timeWindow,
              })),
            },
            {
              input,
              deps,
              streamId,
              fallback: slots.length
                ? "Here are the next available times. Which one works best?"
                : "I couldn't find any available times right now. Would you like me to check again later?",
              contextHint:
                "Offer available reschedule slots and ask which one they prefer.",
            },
          );
          return {
            callSessionId,
            replyText,
            actions: [],
          };
        }
      }
      if (resolvedSlotId) {
        const instance = await deps.workflows.reschedule?.get(
          this.sessionState.rescheduleWorkflowId,
        );
        if (instance) {
          await instance.sendEvent({
            type: RESCHEDULE_WORKFLOW_EVENT_SELECT_SLOT,
            payload: { slotId: resolvedSlotId },
          });
          const replyText = await this.narrateText(
            input,
            deps,
            streamId,
            "Confirm the new appointment time?",
            "Ask the customer to confirm the new appointment time.",
          );
          return {
            callSessionId,
            replyText,
            actions: [],
          };
        }
      }
      if (confirmation !== null) {
        const instance = await deps.workflows.reschedule?.get(
          this.sessionState.rescheduleWorkflowId,
        );
        if (instance) {
          await instance.sendEvent({
            type: RESCHEDULE_WORKFLOW_EVENT_CONFIRM,
            payload: { confirmed: confirmation },
          });
          this.sessionState = {
            ...this.sessionState,
            availableSlots: undefined,
          };
          await this.state.storage.put("state", this.sessionState);
          const replyText = await this.narrateText(
            input,
            deps,
            streamId,
            confirmation
              ? "Thanks. I'll finalize the reschedule now."
              : "Okay, I won't change the appointment.",
            "Confirm or acknowledge the reschedule decision.",
          );
          return {
            callSessionId,
            replyText,
            actions: [],
          };
        }
      }
      if (availableSlots.length) {
        const replyText = await this.narrateToolResult(
          {
            toolName: "crm.getAvailableSlots",
            result: availableSlots.map((slot) => ({
              date: slot.date,
              timeWindow: slot.timeWindow,
            })),
          },
          {
            input,
            deps,
            streamId,
            fallback:
              "Here are the next available times. Which one works best?",
            contextHint:
              "Offer available reschedule slots and ask which one they prefer.",
          },
        );
        return {
          callSessionId,
          replyText,
          actions: [],
        };
      }
      if (appointments.length) {
        const replyText = await this.narrateToolResult(
          {
            toolName: "crm.listUpcomingAppointments",
            result: appointments.map((appointment) => ({
              id: appointment.id,
              customerId:
                this.sessionState.conversation?.verification.customerId ?? "",
              date: appointment.date,
              timeWindow: appointment.timeWindow,
              addressSummary: appointment.addressSummary,
            })),
          },
          {
            input,
            deps,
            streamId,
            fallback: this.formatAppointmentsResponse(appointments),
            contextHint: "Ask which appointment to reschedule using the list.",
          },
        );
        return {
          callSessionId,
          replyText,
          actions: [],
        };
      }
    }

    return null;
  }

  private async handleToolCallingFlow(
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
    streamId: number,
  ): Promise<AgentMessageOutput | null> {
    const state = this.sessionState.conversation ?? initialConversationState();
    if (!state.verification.verified || !state.verification.customerId) {
      return null;
    }
    const callSessionId = input.callSessionId ?? crypto.randomUUID();
    const model = await this.getModelAdapter(deps);
    const customer = await this.getCustomerContext(deps, input);
    const context = this.buildModelContext();
    const messages = await this.getRecentMessages(deps, callSessionId);
    const acknowledgementPromise = this.shouldPreAcknowledge(input.text)
      ? this.startTurnAcknowledgement(input, deps, streamId)
      : null;
    try {
      const decision = await model.generate({
        text: input.text,
        customer,
        hasContext: Boolean(input.callSessionId),
        context,
        messages,
      });
      if (decision.type === "final") {
        const replyText = this.joinNarration(
          acknowledgementPromise ? await acknowledgementPromise : "",
          decision.text.trim() ||
            "I could not interpret the request. Can you rephrase?",
        );
        this.emitNarratorTokens(replyText, streamId);
        return { callSessionId, replyText, actions: [] };
      }
      const actionPlan = actionPlanSchema.safeParse({
        kind: "tool",
        toolName: decision.toolName,
        arguments: decision.arguments ?? {},
        required: this.getActionPreconditions(decision.toolName),
      });
      if (!actionPlan.success) {
        this.logger.warn(
          {
            callSessionId,
            issues: actionPlan.error.issues.map((issue) => issue.message),
          },
          "conversation.session.action_plan.invalid",
        );
        const replyText = await this.narrateText(
          input,
          deps,
          streamId,
          "I couldn't take that action yet. Can you rephrase?",
          "Ask the caller to rephrase their request.",
        );
        return { callSessionId, replyText, actions: [] };
      }
      const policyGate = this.evaluateActionPlan(actionPlan.data);
      if (!policyGate.ok) {
        const replyText = await this.narrateText(
          input,
          deps,
          streamId,
          policyGate.message ??
            "I need to verify your account before I can help with that.",
          policyGate.contextHint ??
            "Ask for the 5-digit ZIP code to verify the account.",
        );
        return { callSessionId, replyText, actions: [] };
      }
      return await this.executeToolCall(
        actionPlan.data.toolName,
        actionPlan.data.arguments ?? {},
        input,
        deps,
        streamId,
        acknowledgementPromise,
      );
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "conversation.session.tool_call.failed",
      );
      return null;
    }
  }

  private buildModelContext(): string {
    const state = this.sessionState.conversation ?? initialConversationState();
    const lines = [
      `Identity status: ${state.verification.verified ? "verified" : "unknown"}`,
    ];
    if (state.appointments.length) {
      const summary = state.appointments
        .map((appointment, index) => {
          return `${index + 1}) ${this.formatAppointmentLabel(appointment)}`;
        })
        .join(" ");
      lines.push(`Cached appointments: ${summary}`);
    }
    if (this.sessionState.availableSlots?.length) {
      const summary = this.sessionState.availableSlots
        .map((slot, index) => `${index + 1}) ${this.formatSlotLabel(slot)}`)
        .join(" ");
      lines.push(`Cached available slots: ${summary}`);
    }
    return lines.join("\n");
  }

  private normalizeToolArgs(
    toolName: string,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    const state = this.sessionState.conversation ?? initialConversationState();
    const next: Record<string, unknown> & { customerId?: string } = {
      ...args,
    };
    if (!state.verification.verified || !state.verification.customerId) {
      return next;
    }
    switch (toolName) {
      case "crm.listUpcomingAppointments":
      case "crm.getNextAppointment":
      case "crm.getOpenInvoices":
      case "crm.getAvailableSlots":
      case "crm.createAppointment":
        if (!("customerId" in next)) {
          next.customerId = state.verification.customerId;
        }
        break;
      case "crm.verifyAccount":
        if (!("customerId" in next)) {
          next.customerId = state.verification.customerId;
        }
        break;
      default:
        break;
    }
    return next;
  }

  private isScheduleRequest(text: string): boolean {
    return /\b(schedule|book|set up|another appointment|new appointment)\b/i.test(
      text,
    );
  }

  private isAvailabilityRequest(text: string): boolean {
    return /\b(available|availability|openings|times available)\b/i.test(text);
  }

  private shouldPreAcknowledge(text: string): boolean {
    return /\b(appointment|appointments|reschedule|cancel|schedule|book|billing|invoice|balance|payment|pay|charge|policy)\b/i.test(
      text,
    );
  }

  private getActionPreconditions(
    toolName: ActionPlan["toolName"],
  ): ActionPrecondition[] {
    switch (toolName) {
      case "crm.verifyAccount":
      case "crm.lookupCustomerByPhone":
      case "crm.lookupCustomerByNameAndZip":
      case "crm.lookupCustomerByEmail":
      case "agent.escalate":
      case "agent.fallback":
        return [];
      default:
        return ["verified"];
    }
  }

  private evaluateActionPlan(plan: ActionPlan): {
    ok: boolean;
    message?: string;
    contextHint?: string;
  } {
    const state = this.sessionState.conversation ?? initialConversationState();
    const required = plan.required ?? [];
    if (required.includes("verified") && !state.verification.verified) {
      return {
        ok: false,
        message: "Please share the 5-digit ZIP code on your account first.",
        contextHint: "Ask for the 5-digit ZIP code to verify the account.",
      };
    }
    if (required.includes("has_appointments") && !state.appointments.length) {
      return {
        ok: false,
        message: "Let me pull up your upcoming appointments first.",
        contextHint: "Acknowledge and say you're fetching appointments.",
      };
    }
    if (
      required.includes("has_available_slots") &&
      !(this.sessionState.availableSlots?.length ?? 0)
    ) {
      return {
        ok: false,
        message: "Let me check the available times first.",
        contextHint: "Acknowledge and say you're checking availability.",
      };
    }
    if (
      required.includes("pending_cancellation") &&
      !state.pendingCancellationId
    ) {
      return {
        ok: false,
        message: "Which appointment would you like to cancel?",
        contextHint: "Ask which appointment should be canceled.",
      };
    }
    return { ok: true };
  }

  private startTurnAcknowledgement(
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
    streamId: number,
  ): Promise<string> {
    return this.narrateText(
      input,
      deps,
      streamId,
      "Got it. Give me a moment while I check.",
      "Acknowledge the request briefly and say you're checking. Don't ask questions yet.",
    );
  }

  private async executeToolCall(
    toolName: string,
    args: Record<string, unknown>,
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
    streamId: number,
    acknowledgementPromise?: Promise<string> | null,
  ): Promise<AgentMessageOutput> {
    const callSessionId = input.callSessionId ?? crypto.randomUUID();
    const normalizedArgs = this.normalizeToolArgs(toolName, args) as {
      appointmentId?: string;
      slotId?: string;
      reason?: string;
      summary?: string;
      customerId?: string;
    };
    const activeAcknowledgementPromise =
      acknowledgementPromise ??
      this.startToolAcknowledgement(toolName, input, deps, streamId);
    if (acknowledgementPromise) {
      this.emitToolStatus(toolName);
    }

    if (toolName === "crm.cancelAppointment") {
      const appointmentId =
        typeof normalizedArgs.appointmentId === "string"
          ? normalizedArgs.appointmentId
          : null;
      const startResult = await this.handleCancelStart({
        callSessionId,
        customerId:
          this.sessionState.conversation?.verification.customerId ?? undefined,
        phoneNumber: input.phoneNumber,
        message: input.text,
      });
      if (!startResult.ok) {
        const acknowledgementText = await activeAcknowledgementPromise;
        const replyText = await this.narrateText(
          input,
          deps,
          streamId,
          startResult.message ?? "Cancellation is temporarily unavailable.",
          "Apologize and explain cancellation is unavailable right now.",
        );
        return {
          callSessionId,
          replyText: this.joinNarration(acknowledgementText, replyText),
          actions: [],
        };
      }
      const appointments = startResult.appointments ?? [];
      if (!appointmentId) {
        const acknowledgementText = await activeAcknowledgementPromise;
        const replyText = await this.narrateToolResult(
          {
            toolName: "crm.listUpcomingAppointments",
            result: appointments.map((appointment) => ({
              id: appointment.id,
              customerId:
                this.sessionState.conversation?.verification.customerId ?? "",
              date: appointment.date,
              timeWindow: appointment.timeWindow,
              addressSummary: appointment.addressSummary,
            })),
          },
          {
            input,
            deps,
            streamId,
            fallback: appointments.length
              ? this.formatAppointmentsResponse(appointments)
              : "I couldn't find any upcoming appointments to cancel.",
            contextHint: "Ask which appointment to cancel using the list.",
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(acknowledgementText, replyText),
          actions: [],
        };
      }
      if (this.sessionState.cancelWorkflowId && deps.workflows.cancel) {
        const instance = await deps.workflows.cancel.get(
          this.sessionState.cancelWorkflowId,
        );
        await instance.sendEvent({
          type: CANCEL_WORKFLOW_EVENT_SELECT_APPOINTMENT,
          payload: { appointmentId },
        });
        const state =
          this.sessionState.conversation ?? initialConversationState();
        this.sessionState = {
          ...this.sessionState,
          conversation: applyIntent(state, {
            type: "cancel_requested",
            appointmentId,
          }),
        };
        await this.state.storage.put("state", this.sessionState);
      }
      const acknowledgementText = await activeAcknowledgementPromise;
      const replyText = await this.narrateText(
        input,
        deps,
        streamId,
        "Confirm cancelling this appointment?",
        "Ask the customer to confirm cancelling the selected appointment.",
      );
      return {
        callSessionId,
        replyText: this.joinNarration(acknowledgementText, replyText),
        actions: [],
      };
    }

    if (toolName === "crm.rescheduleAppointment") {
      const appointmentId =
        typeof normalizedArgs.appointmentId === "string"
          ? normalizedArgs.appointmentId
          : null;
      const slotId =
        typeof normalizedArgs.slotId === "string"
          ? normalizedArgs.slotId
          : null;
      const startResult = await this.handleRescheduleStart({
        callSessionId,
        customerId:
          this.sessionState.conversation?.verification.customerId ?? undefined,
        phoneNumber: input.phoneNumber,
        message: input.text,
      });
      if (!startResult.ok) {
        const acknowledgementText = await activeAcknowledgementPromise;
        const replyText = await this.narrateText(
          input,
          deps,
          streamId,
          startResult.message ?? "Rescheduling is temporarily unavailable.",
          "Apologize and explain rescheduling is unavailable right now.",
        );
        return {
          callSessionId,
          replyText: this.joinNarration(acknowledgementText, replyText),
          actions: [],
        };
      }
      const appointments = startResult.appointments ?? [];
      if (!appointmentId) {
        const acknowledgementText = await activeAcknowledgementPromise;
        const replyText = await this.narrateToolResult(
          {
            toolName: "crm.listUpcomingAppointments",
            result: appointments.map((appointment) => ({
              id: appointment.id,
              customerId:
                this.sessionState.conversation?.verification.customerId ?? "",
              date: appointment.date,
              timeWindow: appointment.timeWindow,
              addressSummary: appointment.addressSummary,
            })),
          },
          {
            input,
            deps,
            streamId,
            fallback: appointments.length
              ? this.formatAppointmentsResponse(appointments)
              : "I couldn't find any upcoming appointments to reschedule.",
            contextHint: "Ask which appointment to reschedule using the list.",
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(acknowledgementText, replyText),
          actions: [],
        };
      }
      if (this.sessionState.rescheduleWorkflowId && deps.workflows.reschedule) {
        const instance = await deps.workflows.reschedule.get(
          this.sessionState.rescheduleWorkflowId,
        );
        await instance.sendEvent({
          type: RESCHEDULE_WORKFLOW_EVENT_SELECT_APPOINTMENT,
          payload: { appointmentId },
        });
      }
      if (!slotId) {
        const customerId =
          this.sessionState.conversation?.verification.customerId ?? null;
        const slots = customerId
          ? await getAvailableSlots(deps.crm, customerId, { daysAhead: 14 })
          : [];
        this.sessionState = {
          ...this.sessionState,
          availableSlots: slots.map((slot) => ({
            id: slot.id,
            date: slot.date,
            timeWindow: slot.timeWindow,
          })),
        };
        await this.state.storage.put("state", this.sessionState);
        const acknowledgementText = await activeAcknowledgementPromise;
        const replyText = await this.narrateToolResult(
          {
            toolName: "crm.getAvailableSlots",
            result: slots.map((slot) => ({
              date: slot.date,
              timeWindow: slot.timeWindow,
            })),
          },
          {
            input,
            deps,
            streamId,
            fallback: slots.length
              ? "Here are the next available times. Which one works best?"
              : "I couldn't find any available times right now. Would you like me to check again later?",
            contextHint:
              "Offer available reschedule slots and ask which one they prefer.",
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(acknowledgementText, replyText),
          actions: [],
        };
      }
      if (this.sessionState.rescheduleWorkflowId && deps.workflows.reschedule) {
        const instance = await deps.workflows.reschedule.get(
          this.sessionState.rescheduleWorkflowId,
        );
        await instance.sendEvent({
          type: RESCHEDULE_WORKFLOW_EVENT_SELECT_SLOT,
          payload: { slotId },
        });
      }
      const acknowledgementText = await activeAcknowledgementPromise;
      const replyText = await this.narrateText(
        input,
        deps,
        streamId,
        "Confirm the new appointment time?",
        "Ask the customer to confirm the new appointment time.",
      );
      return {
        callSessionId,
        replyText: this.joinNarration(acknowledgementText, replyText),
        actions: [],
      };
    }

    const validation = validateToolArgs(toolName as never, normalizedArgs);
    if (!validation.ok) {
      const acknowledgementText = await activeAcknowledgementPromise;
      const replyText = await this.narrateText(
        input,
        deps,
        streamId,
        validation.message,
        "Ask the customer for the missing details.",
      );
      return {
        callSessionId,
        replyText: this.joinNarration(acknowledgementText, replyText),
        actions: [],
      };
    }

    switch (toolName) {
      case "crm.listUpcomingAppointments": {
        const listArgs = validation.data as {
          customerId?: string;
          limit?: number;
        };
        const customerId =
          listArgs.customerId ??
          this.sessionState.conversation?.verification.customerId ??
          "";
        const limit = listArgs.limit ?? 3;
        const appointments = await listUpcomingAppointments(
          deps.crm,
          customerId,
          limit,
        );
        await this.updateAppointmentSummary(
          deps,
          callSessionId,
          input.phoneNumber,
          appointments,
        );
        const acknowledgementText = await activeAcknowledgementPromise;
        const replyText = await this.narrateToolResult(
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
            deps,
            streamId,
            fallback: appointments.length
              ? this.formatAppointmentsResponse(appointments)
              : "I couldn't find any upcoming appointments. Would you like to schedule one?",
            contextHint: "Share upcoming appointments and ask next step.",
          },
        );
        const state =
          this.sessionState.conversation ?? initialConversationState();
        this.sessionState = {
          ...this.sessionState,
          conversation: applyIntent(state, {
            type: "appointments_loaded",
            appointments: appointments.map((appointment) => ({
              id: appointment.id,
              date: appointment.date,
              timeWindow: appointment.timeWindow,
              addressSummary: appointment.addressSummary,
            })),
          }),
        };
        await this.state.storage.put("state", this.sessionState);
        return {
          callSessionId,
          replyText: this.joinNarration(acknowledgementText, replyText),
          actions: [],
        };
      }
      case "crm.getNextAppointment": {
        const nextArgs = validation.data as { customerId?: string };
        const customerId =
          nextArgs.customerId ??
          this.sessionState.conversation?.verification.customerId ??
          "";
        const appointment = await deps.crm.getNextAppointment(customerId);
        const acknowledgementText = await activeAcknowledgementPromise;
        const replyText = await this.narrateToolResult(
          {
            toolName: "crm.getNextAppointment",
            result: appointment
              ? {
                  date: appointment.date,
                  timeWindow: appointment.timeWindow,
                  addressSummary: appointment.addressSummary,
                  ...(appointment.addressId
                    ? { addressId: appointment.addressId }
                    : {}),
                }
              : null,
          },
          {
            input,
            deps,
            streamId,
            fallback: appointment
              ? this.formatAppointmentsResponse([
                  {
                    id: appointment.id,
                    date: appointment.date,
                    timeWindow: appointment.timeWindow,
                    addressSummary: appointment.addressSummary,
                  },
                ])
              : "I couldn't find any upcoming appointments. Would you like to schedule one?",
            contextHint: "Share the next appointment details.",
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(acknowledgementText, replyText),
          actions: [],
        };
      }
      case "crm.getAppointmentById": {
        const appointmentId = (validation.data as { appointmentId: string })
          .appointmentId;
        const appointment = await deps.crm.getAppointmentById(appointmentId);
        const acknowledgementText = await activeAcknowledgementPromise;
        const replyText = await this.narrateToolResult(
          {
            toolName: "crm.getAppointmentById",
            result: appointment
              ? {
                  date: appointment.date,
                  timeWindow: appointment.timeWindow,
                  addressSummary: appointment.addressSummary,
                  ...(appointment.addressId
                    ? { addressId: appointment.addressId }
                    : {}),
                }
              : null,
          },
          {
            input,
            deps,
            streamId,
            fallback: appointment
              ? this.formatAppointmentsResponse([
                  {
                    id: appointment.id,
                    date: appointment.date,
                    timeWindow: appointment.timeWindow,
                    addressSummary: appointment.addressSummary,
                  },
                ])
              : "I couldn't find that appointment. Want me to list upcoming appointments?",
            contextHint:
              "Share the appointment details or ask for a new choice.",
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(acknowledgementText, replyText),
          actions: [],
        };
      }
      case "crm.getOpenInvoices": {
        const invoices = await getOpenInvoices(
          deps.crm,
          this.sessionState.conversation?.verification.customerId ?? "",
        );
        const balanceCents = invoices.reduce(
          (sum, invoice) => sum + (invoice.balanceCents ?? 0),
          0,
        );
        const balance =
          invoices.find((invoice) => invoice.balance)?.balance ??
          (balanceCents / 100).toFixed(2);
        const currency = invoices.find((invoice) => invoice.currency)?.currency;
        const acknowledgementText = await activeAcknowledgementPromise;
        const replyText = await this.narrateToolResult(
          {
            toolName: "crm.getOpenInvoices",
            result: {
              balanceCents,
              balance,
              currency,
              invoiceCount: invoices.length,
            },
          },
          {
            input,
            deps,
            streamId,
            fallback: invoices.length
              ? this.formatInvoicesResponse(invoices)
              : "You're all set. I don't see any open invoices right now.",
            contextHint: "Share the balance and invoice status.",
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(acknowledgementText, replyText),
          actions: [],
        };
      }
      case "crm.getAvailableSlots": {
        const slotArgs = validation.data as {
          customerId?: string;
          daysAhead?: number;
          fromDate?: string;
          toDate?: string;
          preference?: "morning" | "afternoon" | "any";
        };
        const customerId =
          slotArgs.customerId ??
          this.sessionState.conversation?.verification.customerId ??
          "";
        const slots = await getAvailableSlots(deps.crm, customerId, slotArgs);
        this.sessionState = {
          ...this.sessionState,
          availableSlots: slots.map((slot) => ({
            id: slot.id,
            date: slot.date,
            timeWindow: slot.timeWindow,
          })),
        };
        await this.state.storage.put("state", this.sessionState);
        const acknowledgementText = await activeAcknowledgementPromise;
        const replyText = await this.narrateToolResult(
          {
            toolName: "crm.getAvailableSlots",
            result: slots.map((slot) => ({
              date: slot.date,
              timeWindow: slot.timeWindow,
            })),
          },
          {
            input,
            deps,
            streamId,
            fallback: slots.length
              ? "Here are the next available times. Which one works best?"
              : "I couldn't find any available times right now. Would you like me to check again later?",
            contextHint:
              "Offer available times and confirm whether the on-file address is correct.",
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(acknowledgementText, replyText),
          actions: [],
        };
      }
      case "crm.getServicePolicy": {
        const topic = (validation.data as { topic: string }).topic;
        const policyText = await getServicePolicy(deps.crm, topic);
        const acknowledgementText = await activeAcknowledgementPromise;
        const replyText = await this.narrateToolResult(
          {
            toolName: "crm.getServicePolicy",
            result: { text: policyText },
          },
          {
            input,
            deps,
            streamId,
            fallback: policyText,
            contextHint: "Share the requested service policy.",
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(acknowledgementText, replyText),
          actions: [],
        };
      }
      case "crm.escalate":
      case "agent.escalate": {
        const summary =
          typeof normalizedArgs.summary === "string"
            ? normalizedArgs.summary
            : input.text;
        const result = await deps.crm.escalate({
          reason:
            typeof normalizedArgs.reason === "string"
              ? normalizedArgs.reason
              : "customer_request",
          summary,
          customerId:
            this.sessionState.conversation?.verification.customerId ??
            undefined,
        });
        const acknowledgementText = await activeAcknowledgementPromise;
        const replyText = result.ok
          ? await this.narrateToolResult(
              {
                toolName: "crm.escalate",
                result: { ok: true, ticketId: result.ticketId },
              },
              {
                input,
                deps,
                streamId,
                fallback: `I've asked a specialist to reach out. Your ticket ID is ${result.ticketId ?? "on file"}.`,
                contextHint:
                  "Confirm that a specialist will follow up and share the ticket id if available.",
              },
            )
          : await this.narrateText(
              input,
              deps,
              streamId,
              "I'm sorry, I couldn't start an escalation right now. Please try again in a moment.",
              "Apologize and ask them to try again shortly.",
            );
        return {
          callSessionId,
          replyText: this.joinNarration(acknowledgementText, replyText),
          actions: [],
        };
      }
      case "crm.createAppointment": {
        const createArgs = validation.data as { customerId?: string };
        const customerId =
          createArgs.customerId ??
          this.sessionState.conversation?.verification.customerId ??
          "";
        const result = await createAppointment(deps.crm, {
          ...validation.data,
          customerId,
        } as {
          customerId: string;
          preferredWindow: string;
          notes?: string;
          pestType?: string;
        });
        const acknowledgementText = await activeAcknowledgementPromise;
        const replyText = await this.narrateToolResult(
          {
            toolName: "crm.createAppointment",
            result,
          },
          {
            input,
            deps,
            streamId,
            fallback: result.ok
              ? "You're all set. I've scheduled that appointment. Is the on-file address correct?"
              : "I couldn't create that appointment yet. Want to try a different time?",
            contextHint:
              "Confirm the appointment was scheduled and confirm the address on file.",
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(acknowledgementText, replyText),
          actions: [],
        };
      }
      case "agent.fallback": {
        const acknowledgementText = await activeAcknowledgementPromise;
        const replyText = await this.narrateText(
          input,
          deps,
          streamId,
          "I can help with appointments, billing, or service questions. What can I do for you?",
          "Politely redirect to supported topics.",
        );
        return {
          callSessionId,
          replyText: this.joinNarration(acknowledgementText, replyText),
          actions: [],
        };
      }
      default: {
        const acknowledgementText = await activeAcknowledgementPromise;
        const replyText = await this.narrateText(
          input,
          deps,
          streamId,
          "I can help with appointments, billing, or service questions. What can I do for you?",
          "Politely redirect to supported topics.",
        );
        return {
          callSessionId,
          replyText: this.joinNarration(acknowledgementText, replyText),
          actions: [],
        };
      }
    }
  }

  private startToolAcknowledgement(
    toolName: string,
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
    streamId: number,
  ): Promise<string> {
    const parsed = toolAcknowledgementSchema.safeParse(toolName);
    if (!parsed.success) {
      return Promise.resolve("");
    }
    const acknowledgement = toolAcknowledgements[parsed.data];
    if (acknowledgement.status) {
      this.emitEvent({ type: "status", text: acknowledgement.status });
    }
    return this.narrateText(
      input,
      deps,
      streamId,
      acknowledgement.fallback,
      acknowledgement.contextHint,
    );
  }

  private emitToolStatus(toolName: string): void {
    const parsed = toolAcknowledgementSchema.safeParse(toolName);
    if (!parsed.success) {
      return;
    }
    const acknowledgement = toolAcknowledgements[parsed.data];
    if (acknowledgement.status) {
      this.emitEvent({ type: "status", text: acknowledgement.status });
    }
  }

  private joinNarration(first: string, second: string): string {
    return [first, second]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private parseConfirmation(value: string): boolean | null {
    if (/^(yes|yep|yeah|sure)\b/i.test(value)) {
      return true;
    }
    if (/^(no|nope|nah)\b/i.test(value)) {
      return false;
    }
    return null;
  }

  private async routeIntent(
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
  ): Promise<string | null> {
    const state = this.sessionState.conversation ?? initialConversationState();
    if (!state.verification.verified) {
      return null;
    }
    const customer = await this.getCustomerContext(deps, input);
    const model = await this.getModelAdapter(deps);
    const modelInput: AgentModelInput = {
      text: input.text,
      customer,
      hasContext: Boolean(input.callSessionId),
    };
    try {
      const routed = await model.route(modelInput);
      return routed.intent;
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "conversation.session.route.failed",
      );
      const fallback = this.inferPendingIntent(input.text);
      return fallback?.kind ?? null;
    }
  }

  private async getModelAdapter(
    deps: ReturnType<typeof createDependencies>,
  ): Promise<ReturnType<typeof deps.modelFactory>> {
    const agentConfig = await deps.agentConfig.get(deps.agentConfigDefaults);
    return deps.modelFactory(agentConfig);
  }

  private async getCustomerContext(
    deps: ReturnType<typeof createDependencies>,
    input: AgentMessageInput,
  ): Promise<AgentModelInput["customer"]> {
    const customerId =
      this.sessionState.conversation?.verification.customerId ?? null;
    if (customerId) {
      const cached = await deps.customers.get(customerId);
      if (cached) {
        return {
          id: cached.id,
          displayName: cached.displayName,
          phoneE164: cached.phoneE164,
          addressSummary: cached.addressSummary ?? "the service address",
        };
      }
    }
    const matches = await deps.crm.lookupCustomerByPhone(input.phoneNumber);
    const match = Array.isArray(matches) ? matches[0] : null;
    if (match) {
      return {
        id: match.id,
        displayName: match.displayName,
        phoneE164: match.phoneE164,
        addressSummary: match.addressSummary,
      };
    }
    return {
      id: customerId ?? "unknown",
      displayName: "Customer",
      phoneE164: input.phoneNumber,
      addressSummary: "the service address",
    };
  }

  private async narrateText(
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
    streamId: number,
    fallback: string,
    contextHint?: string,
  ): Promise<string> {
    return this.narrateToolResult(
      {
        toolName: "agent.message",
        result: {
          kind: "message",
          details: fallback,
        },
      },
      { input, deps, streamId, fallback, contextHint },
    );
  }

  private async narrateToolResult(
    toolResult: ToolResult,
    options: {
      input: AgentMessageInput;
      deps: ReturnType<typeof createDependencies>;
      streamId: number;
      fallback: string;
      contextHint?: string;
      messages?: Array<{ role: "user" | "assistant"; content: string }>;
    },
  ): Promise<string> {
    const { input, deps, streamId, fallback, contextHint, messages } = options;
    const model = await this.getModelAdapter(deps);
    const customer = await this.getCustomerContext(deps, input);
    const callSessionId =
      input.callSessionId ?? this.sessionState.lastCallSessionId ?? null;
    const recentMessages =
      messages ??
      (callSessionId ? await this.getRecentMessages(deps, callSessionId) : []);
    const respondInput: AgentResponseInput = {
      text: input.text,
      customer,
      hasContext: Boolean(input.callSessionId),
      context: contextHint,
      messages: recentMessages,
      ...toolResult,
    };
    try {
      if (model.respondStream) {
        let combined = "";
        let waitingForJson = false;
        let checkedForJson = false;
        for await (const token of model.respondStream(respondInput)) {
          if (this.canceledStreamIds.has(streamId)) {
            return this.sanitizeNarratorOutput(combined.trim()) || fallback;
          }
          combined += token;
          if (!checkedForJson) {
            const trimmed = combined.trimStart();
            if (trimmed) {
              checkedForJson = true;
              waitingForJson =
                trimmed.startsWith("{") || trimmed.startsWith("[");
            }
          }
          if (!waitingForJson) {
            this.emitEvent({ type: "token", text: token });
          }
        }
        const sanitized = this.sanitizeNarratorOutput(combined.trim());
        if (waitingForJson && sanitized) {
          this.emitNarratorTokens(sanitized, streamId);
        }
        return sanitized || fallback;
      }
      const text = await model.respond(respondInput);
      const trimmed = this.sanitizeNarratorOutput(text.trim());
      if (trimmed) {
        this.emitNarratorTokens(trimmed, streamId);
        return trimmed;
      }
      return fallback;
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "conversation.session.narrate.failed",
      );
      this.emitNarratorTokens(fallback, streamId);
      return fallback;
    }
  }

  private sanitizeNarratorOutput(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) {
      return "";
    }
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as
          | { answer?: string }
          | Array<{ answer?: string }>;
        if (Array.isArray(parsed)) {
          const first = parsed.find((entry) => entry?.answer);
          if (first?.answer) {
            return String(first.answer).trim();
          }
        } else if (parsed.answer) {
          return String(parsed.answer).trim();
        }
      } catch {
        // Fall through to regex extraction for malformed JSON.
      }
      const match = trimmed.match(/"answer"\s*:\s*"([^"]*)"/);
      if (match?.[1]) {
        return match[1].replace(/\\"/g, '"').trim();
      }
    }
    return trimmed;
  }

  private async selectOption(
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
    kind: "appointment" | "slot" | "confirmation",
    options: SelectionOption[],
  ): Promise<string | null> {
    if (!options.length) {
      return null;
    }
    const model = await this.getModelAdapter(deps);
    try {
      const selection = await model.selectOption({
        text: input.text,
        options,
        kind,
      });
      return selection.selectedId ?? null;
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "conversation.session.select.failed",
      );
      return null;
    }
  }

  private resolveAppointmentSelection(
    text: string,
    appointments: Array<{
      id: string;
      date: string;
      timeWindow: string;
      addressSummary: string;
    }>,
  ): string | null {
    if (!appointments.length) {
      return null;
    }
    const lowered = text.toLowerCase();
    const indexMatch = lowered.match(/\b(1|2|3|first|second|third)\b/);
    if (indexMatch) {
      const token = indexMatch[1];
      const index =
        token === "1" || token === "first"
          ? 0
          : token === "2" || token === "second"
            ? 1
            : 2;
      const selected = appointments[index];
      return selected?.id ?? null;
    }
    const dateMatch = lowered.match(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/,
    );
    if (dateMatch) {
      const monthToken = dateMatch[1];
      if (!monthToken) {
        return null;
      }
      const day = dateMatch[2]?.padStart(2, "0") ?? "";
      const monthMap: Record<string, string> = {
        jan: "01",
        feb: "02",
        mar: "03",
        apr: "04",
        may: "05",
        jun: "06",
        jul: "07",
        aug: "08",
        sep: "09",
        oct: "10",
        nov: "11",
        dec: "12",
      };
      const month = monthMap[monthToken];
      if (month && day) {
        const match = appointments.find(
          (appointment) => appointment.date.slice(5) === `${month}-${day}`,
        );
        if (match) {
          return match.id;
        }
      }
    }
    return null;
  }

  private emitNarratorTokens(text: string, streamId: number) {
    if (this.canceledStreamIds.has(streamId)) {
      return;
    }
    const turnStart = Date.now();
    let firstTokenAt: number | null = null;
    const parts = text.split(/\s+/).filter(Boolean);
    if (!parts.length) {
      return;
    }
    for (const part of parts) {
      if (this.canceledStreamIds.has(streamId)) {
        return;
      }
      if (firstTokenAt === null) {
        firstTokenAt = Date.now();
        this.logger.info(
          {
            callSessionId:
              this.activeCallSessionId ??
              this.sessionState.lastCallSessionId ??
              "new",
            first_token_ms: firstTokenAt - turnStart,
          },
          "conversation.session.narrator.first_token",
        );
      }
      this.emitEvent({ type: "token", text: `${part} ` });
    }
  }

  private formatAppointmentsResponse(
    appointments: Array<{
      id: string;
      date: string;
      timeWindow: string;
      addressSummary: string;
    }>,
  ): string {
    const intro =
      appointments.length === 1
        ? "Here is your upcoming appointment:"
        : "Here are your upcoming appointments:";
    const lines = appointments.map((appointment, index) => {
      const dateLabel = appointment.date;
      const timeLabel = appointment.timeWindow;
      return `${index + 1}) ${dateLabel} ${timeLabel} at ${appointment.addressSummary}`;
    });
    return [intro, ...lines].join(" ");
  }

  private formatAppointmentLabel(appointment: {
    date: string;
    timeWindow: string;
    addressSummary: string;
  }): string {
    return `${appointment.date} ${appointment.timeWindow} at ${appointment.addressSummary}`;
  }

  private formatSlotLabel(slot: { date: string; timeWindow: string }): string {
    return `${slot.date} ${slot.timeWindow}`;
  }

  private formatInvoicesResponse(
    invoices: Array<{
      id: string;
      balanceCents: number;
      balance?: string;
      currency?: string;
      dueDate: string;
      status: "open" | "paid" | "overdue";
    }>,
  ): string {
    const intro =
      invoices.length === 1
        ? "Here is your open invoice:"
        : "Here are your open invoices:";
    const lines = invoices.map((invoice, index) => {
      const balance =
        invoice.balance ?? (invoice.balanceCents / 100).toFixed(2);
      const currency = invoice.currency ?? "USD";
      const amount =
        currency === "USD" ? `$${balance}` : `${balance} ${currency}`;
      const status = invoice.status === "overdue" ? " (overdue)" : "";
      return `${index + 1}) ${amount} due ${invoice.dueDate}${status}`;
    });
    return [intro, ...lines].join(" ");
  }

  private async handleBargeIn(): Promise<void> {
    const streamId = this.activeStreamId;
    this.canceledStreamIds.add(streamId);
    await this.setSpeaking(false);
  }

  private async setSpeaking(value: boolean): Promise<void> {
    if (this.speaking === value) {
      return;
    }
    this.speaking = value;
    await this.state.storage.put("speaking", value);
    this.emitEvent({
      type: "speaking",
      data: { value },
    });
  }

  private emitEvent(event: Omit<ConversationEvent, "id" | "at">): void {
    if (event.type === "token") {
      this.recordTurnToken();
    }
    if (event.type === "status") {
      this.recordTurnStatus();
    }
    const enriched: ConversationEvent = {
      ...event,
      id: ++this.lastEventId,
      at: new Date().toISOString(),
    };
    this.eventBuffer.push(enriched);
    if (this.eventBuffer.length > MAX_EVENT_BUFFER) {
      this.eventBuffer.shift();
    }
    void this.state.storage.put({
      events: this.eventBuffer,
      lastEventId: this.lastEventId,
    });
    for (const socket of this.connections) {
      this.sendTo(socket, enriched);
    }
  }

  private collectEventsAfter(lastEventId?: number): ConversationEvent[] {
    if (!lastEventId) {
      return [...this.eventBuffer];
    }
    return this.eventBuffer.filter((event) => event.id > lastEventId);
  }

  private recordTurnToken(): void {
    if (!this.turnMetrics || this.turnMetrics.firstTokenAt !== null) {
      return;
    }
    this.turnMetrics.firstTokenAt = Date.now();
  }

  private recordTurnStatus(): void {
    if (!this.turnMetrics || this.turnMetrics.firstStatusAt !== null) {
      return;
    }
    this.turnMetrics.firstStatusAt = Date.now();
  }

  private async replayEvents(
    lastEventId: number | undefined,
    socket: WebSocket,
  ): Promise<void> {
    const events = this.collectEventsAfter(lastEventId);
    for (const event of events) {
      this.sendTo(socket, event);
    }
    this.sendTo(socket, {
      type: "resync",
      data: {
        fromId: lastEventId ?? null,
        toId: this.lastEventId,
        speaking: this.speaking,
        state: this.sessionState.conversation ?? initialConversationState(),
      },
    });
  }

  private sendTo(
    socket: WebSocket,
    event: Omit<ConversationEvent, "id" | "at"> | ConversationEvent,
  ) {
    const payload =
      "id" in event && "at" in event
        ? event
        : {
            ...event,
            id: this.lastEventId,
            at: new Date().toISOString(),
          };
    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "conversation.session.send_failed",
      );
      this.connections.delete(socket);
    }
  }
}

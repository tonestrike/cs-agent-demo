import { type CustomerCache, normalizePhoneE164 } from "@pestcall/core";

import { createDependencies } from "../context";
import {
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
import {
  DEFAULT_TOOL_STATUS_MESSAGE,
  getToolStatusConfig,
} from "../models/tool-status";
import type {
  AgentModelInput,
  AgentResponseInput,
  SelectionOption,
  ToolResult,
} from "../models/types";
import {
  actionPlanSchema,
  isMultipleToolCalls,
  isSingleToolCall,
} from "../models/types";
import {
  type RealtimeKitTokenPayload,
  addRealtimeKitGuestParticipant,
  addRealtimeKitParticipant,
  createRealtimeKitMeeting,
  getRealtimeKitConfigSummary,
  refreshRealtimeKitToken,
} from "../realtime-kit";
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

// Extracted modules
import {
  type ClientMessage,
  type ConversationEvent,
  FILLER_TIMEOUT_MS,
  MAX_EVENT_BUFFER,
  type SessionState,
  evaluateActionPlan,
  formatAppointmentLabel,
  formatAppointmentsResponse,
  formatAvailableSlotsResponse,
  formatConversationSummary,
  formatInvoicesResponse,
  formatSlotLabel,
  getActionPreconditions,
  normalizeToolArgs,
  sanitizeNarratorOutput,
  toolAcknowledgementSchema,
} from "./conversation-session/index";

const INTERPRET_FALLBACK_TEXT =
  "I could not interpret the request. Can you rephrase? I can also connect you with a person.";

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
  private activeTurnId: number | null = null;
  private activeMessageId: string | null = null;
  private turnCounter = 0;
  private statusSequence = 0;
  private activeStatusText: string | null = null;
  private turnModelCalls: Array<{
    kind: "generate" | "respond" | "status";
    provider: string;
    modelId: string | null;
  }> = [];
  private turnDecision: {
    decisionType: string;
    toolName?: string | null;
    argKeys?: string[];
    acknowledgementLength?: number;
    finalLength?: number;
  } | null = null;
  private turnToolCalls: Array<{ toolName: string; argKeys: string[] }> = [];
  private turnStatusTexts: string[] = [];
  private turnMetrics: {
    callSessionId: string;
    startedAt: number;
    firstTokenAt: number | null;
    firstStatusAt: number | null;
  } | null = null;
  private turnTimings: {
    verificationMs?: number;
    workflowSelectionMs?: number;
    toolFlowMs?: number;
    agentMessageMs?: number;
    totalMs?: number;
    modelAdapterMs?: number;
    customerContextMs?: number;
    recentMessagesMs?: number;
    modelGenerateMs?: number;
    preWorkMs?: number;
  } | null = null;
  private cachedCustomerContext: AgentModelInput["customer"] | null = null;
  private cachedModelAdapter: ReturnType<
    ReturnType<typeof createDependencies>["modelFactory"]
  > | null = null;

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

    if (request.method === "GET" && url.pathname.endsWith("/summary")) {
      return this.handleSummaryRequest(request);
    }

    if (request.method === "GET" && url.pathname.endsWith("/debug")) {
      return this.handleDebugRequest(request);
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
    try {
      const parsed = this.parseClientMessage(raw);
      if (!parsed) {
        this.sendTo(socket, {
          type: "error",
          text: "Invalid message payload.",
        });
        return;
      }

      this.logger.info(
        {
          callSessionId:
            this.activeCallSessionId ??
            ("callSessionId" in parsed ? parsed.callSessionId : null) ??
            null,
          type: parsed.type,
          textLength:
            typeof (parsed as { text?: string }).text === "string"
              ? ((parsed as { text: string }).text.length ?? 0)
              : 0,
          text: (parsed as { text?: string }).text ?? undefined,
        },
        "conversation.session.socket_message",
      );

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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        { error: message },
        "conversation.session.socket_message.error",
      );
      this.sendTo(socket, {
        type: "error",
        text: `Server error: ${message}`,
      });
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

    this.logger.info(
      {
        inputCallSessionId: input.callSessionId ?? null,
        inputPhone: input.phoneNumber ?? null,
        stateCallSessionId: this.sessionState.lastCallSessionId ?? null,
        statePhone: this.sessionState.lastPhoneNumber ?? null,
        validated: validated.success
          ? {
              callSessionId: validated.data.callSessionId,
              phoneNumber: validated.data.phoneNumber,
              textLength: validated.data.text.length,
            }
          : { error: validated.error.format() },
      },
      "conversation.session.resolve_input",
    );

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
    try {
      const response = await this.runMessage(input);
      return Response.json({
        ok: true,
        callSessionId: response.callSessionId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        { error: message, inputText: input.text?.slice(0, 50) },
        "conversation.session.message.error",
      );
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
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

  private async handleSummaryRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const callSessionId =
      url.searchParams.get("callSessionId") ??
      this.sessionState.lastCallSessionId ??
      null;
    if (!callSessionId) {
      return Response.json(
        { ok: false, error: "Call session id required." },
        { status: 400 },
      );
    }
    const deps = createDependencies(this.env);
    const record = await deps.calls.get(callSessionId);
    if (!record) {
      return Response.json(
        { ok: false, error: "Conversation not found." },
        { status: 404 },
      );
    }
    const summary = formatConversationSummary(record.session, record.turns);
    return Response.json({ ok: true, callSessionId, summary });
  }

  private async handleDebugRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const callSessionId =
      url.searchParams.get("callSessionId") ??
      this.sessionState.lastCallSessionId ??
      null;
    const deps = createDependencies(this.env);
    const record = callSessionId ? await deps.calls.get(callSessionId) : null;
    const events = this.collectEventsAfter();
    const snapshot = {
      ok: true,
      callSessionId,
      sessionState: this.sessionState,
      turnMetrics: this.turnMetrics,
      turnTimings: this.turnTimings,
      turnDecision: this.turnDecision,
      activeTurnId: this.activeTurnId,
      activeMessageId: this.activeMessageId,
      eventBuffer: events.slice(-50),
      dbSession: record?.session ?? null,
      dbTurns: record?.turns ?? [],
    };
    return Response.json(snapshot);
  }

  private async handleRealtimeTokenRequest(
    request: Request,
  ): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const deps = createDependencies(this.env);
    this.logger.info(
      { config: getRealtimeKitConfigSummary(this.env) },
      "conversation.session.rtk_config",
    );

    // Get current call session ID from query param (passed by worker) or fall back to stored state
    const url = new URL(request.url);
    const currentCallSessionId =
      url.searchParams.get("callSessionId") ??
      this.sessionState.lastCallSessionId;
    const meetingId =
      this.sessionState.rtkMeetingId ??
      (await createRealtimeKitMeeting(this.env, this.logger));
    const storedRtkCallSessionId = this.sessionState.rtkCallSessionId;
    const storedMeetingId = this.sessionState.rtkMeetingId;
    const needsFreshParticipant =
      currentCallSessionId !== storedRtkCallSessionId ||
      Boolean(storedMeetingId && storedMeetingId !== meetingId);

    this.logger.info(
      {
        currentCallSessionId,
        storedRtkCallSessionId,
        meetingId,
        storedMeetingId,
        needsFreshParticipant,
        hasExistingParticipant: Boolean(
          this.sessionState.rtkGuestParticipantId,
        ),
      },
      "conversation.session.rtk_token_check",
    );

    const verifiedCustomerId =
      this.sessionState.conversation?.verification.customerId;
    let customer: CustomerCache | null = null;
    if (verifiedCustomerId) {
      customer = await deps.customers.get(verifiedCustomerId);
    }
    if (!customer) {
      // Try to refresh existing participant if same call session
      const guestParticipantId = this.sessionState.rtkGuestParticipantId;
      if (guestParticipantId && !needsFreshParticipant) {
        try {
          const token = await refreshRealtimeKitToken(
            this.env,
            guestParticipantId,
            this.logger,
            { meetingId },
          );
          return Response.json({ ok: true, ...token });
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown";
          this.logger.warn(
            { error: message, participantId: guestParticipantId },
            "conversation.session.rtk_guest_refresh_failed",
          );
        }
      }
      // Create a new participant with unique ID per call session
      const phoneNumber = this.sessionState.lastPhoneNumber;
      const callId = currentCallSessionId ?? this.state.id.toString();
      // Include timestamp to ensure uniqueness even if same call session ID is reused
      const uniqueId = `${callId}:${Date.now()}`;
      const customParticipantId = `session:${uniqueId}`;
      const displayName = phoneNumber ? `Caller ${phoneNumber}` : "Caller";
      const token = await addRealtimeKitGuestParticipant(
        this.env,
        {
          displayName,
          customParticipantId,
        },
        this.logger,
        { meetingId },
      );
      this.sessionState = {
        ...this.sessionState,
        rtkGuestParticipantId: token.participantId,
        rtkGuestCustomId: customParticipantId,
        rtkCallSessionId: currentCallSessionId,
        rtkMeetingId: meetingId,
      };
      await this.state.storage.put("state", this.sessionState);
      return Response.json({ ok: true, ...token });
    }
    if (!customer) {
      return Response.json(
        { ok: false, error: "Customer lookup required." },
        { status: 400 },
      );
    }
    try {
      const token = await this.getRealtimeKitToken(deps, customer, {
        forceNewParticipant: needsFreshParticipant,
        meetingId,
      });
      // Update the call session tracking for verified customers too
      this.sessionState = {
        ...this.sessionState,
        rtkCallSessionId: currentCallSessionId,
        rtkMeetingId: meetingId,
      };
      await this.state.storage.put("state", this.sessionState);
      return Response.json({ ok: true, ...token });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "RealtimeKit token failed.";
      this.logger.error(
        { error: message, customerId: customer.id },
        "conversation.session.rtk_token_failed",
      );
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }

  private async getRealtimeKitToken(
    deps: ReturnType<typeof createDependencies>,
    customer: CustomerCache,
    options?: { forceNewParticipant?: boolean; meetingId?: string },
  ): Promise<RealtimeKitTokenPayload> {
    const meetingId =
      options?.meetingId ??
      this.sessionState.rtkMeetingId ??
      (await createRealtimeKitMeeting(this.env, this.logger));
    let token: RealtimeKitTokenPayload;
    if (customer.participantId && !options?.forceNewParticipant) {
      try {
        token = await refreshRealtimeKitToken(
          this.env,
          customer.participantId,
          this.logger,
          { meetingId },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        this.logger.warn(
          { error: message, participantId: customer.participantId },
          "conversation.session.rtk_refresh_failed",
        );
        token = await addRealtimeKitParticipant(
          this.env,
          customer,
          this.logger,
          { meetingId },
        );
      }
    } else {
      token = await addRealtimeKitParticipant(this.env, customer, this.logger, {
        meetingId,
      });
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
    this.activeTurnId = ++this.turnCounter;
    this.activeMessageId = crypto.randomUUID();
    this.statusSequence = 0;
    this.activeStatusText = null;
    this.turnModelCalls = [];
    this.turnDecision = null;
    this.turnToolCalls = [];
    this.turnStatusTexts = [];
    this.turnTimings = {};
    this.canceledStreamIds.delete(streamId);
    await this.setSpeaking(true);
    let lastStatus = "";
    this.turnMetrics = {
      callSessionId,
      startedAt: Date.now(),
      firstTokenAt: null,
      firstStatusAt: null,
    };
    this.logger.info(
      {
        callSessionId,
        turnId: this.activeTurnId,
        streamId,
        conversation: this.sessionState.conversation,
        pendingIntent: this.sessionState.pendingIntent ?? null,
        cancelWorkflowId: this.sessionState.cancelWorkflowId ?? null,
        rescheduleWorkflowId: this.sessionState.rescheduleWorkflowId ?? null,
        availableSlotsCount: this.sessionState.availableSlots?.length ?? 0,
        verifiedCustomerId:
          this.sessionState.conversation?.verification.customerId ?? null,
        lastPhoneNumber: this.sessionState.lastPhoneNumber ?? null,
      },
      "conversation.session.state.snapshot",
    );
    this.logger.info(
      {
        callSessionId,
        turnId: this.activeTurnId,
        streamId,
        textLength: input.text?.length ?? 0,
        text: input.text ?? "",
        phoneNumber: input.phoneNumber,
        verifiedCustomerId:
          this.sessionState.conversation?.verification.customerId ?? null,
      },
      "conversation.session.turn.start",
    );
    // First-token-fast: emit early acknowledgement for verified users
    // This runs the acknowledgement model call concurrently with other pre-work (fire-and-forget)
    const conversationState =
      this.sessionState.conversation ?? initialConversationState();
    if (conversationState.verification.verified) {
      void this.emitEarlyAcknowledgement(activeInput, deps, streamId);
    }
    let fillerTimer: ReturnType<typeof setTimeout> | null = null;
    let fillerEmitted = false;
    const scheduleFiller = () => {
      if (
        this.turnMetrics?.firstTokenAt !== null ||
        fillerEmitted ||
        this.statusSequence > 0
      ) {
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
          fillerEmitted ||
          this.statusSequence > 0
        ) {
          return;
        }
        fillerEmitted = true;
        // Use empty fallback - all customer-facing text must be model-generated
        void this.emitNarratorStatus(
          activeInput,
          deps,
          streamId,
          "",
          "Acknowledge the request briefly and naturally while you check. Be friendly and conversational.",
        );
      }, FILLER_TIMEOUT_MS);
    };
    scheduleFiller();
    try {
      const verificationStart = Date.now();
      const verificationResponse = await this.handleVerificationGate(
        activeInput,
        deps,
        streamId,
      );
      const verificationMs = Date.now() - verificationStart;
      if (this.turnTimings) {
        this.turnTimings.verificationMs = verificationMs;
      }
      this.logger.info(
        {
          callSessionId,
          turnId: this.activeTurnId,
          verificationMs,
          handled: Boolean(verificationResponse),
        },
        "conversation.session.step.verification",
      );

      if (verificationResponse) {
        this.emitEvent({ type: "final", data: verificationResponse });
        await this.updateSessionState(activeInput, verificationResponse);
        await this.syncConversationState(
          verificationResponse.callSessionId,
          deps,
        );
        const meta = this.buildTurnMeta(callSessionId);
        await this.recordTurns(deps, activeInput, verificationResponse, meta);
        this.logger.info(
          {
            callSessionId,
            turnId: this.activeTurnId,
            replyLength: verificationResponse.replyText.length,
            actions: verificationResponse.actions,
          },
          "conversation.session.turn.complete",
        );
        return verificationResponse;
      }

      // Handle workflow selection
      const workflowStart = Date.now();
      const selectionResponse = await this.handleWorkflowSelection(
        activeInput,
        deps,
        streamId,
      );
      const workflowMs = Date.now() - workflowStart;
      if (this.turnTimings) {
        this.turnTimings.workflowSelectionMs = workflowMs;
      }
      this.logger.info(
        {
          callSessionId,
          turnId: this.activeTurnId,
          workflowSelectionMs: workflowMs,
          handled: Boolean(selectionResponse),
        },
        "conversation.session.step.workflow_selection",
      );
      if (selectionResponse) {
        this.emitEvent({ type: "final", data: selectionResponse });
        await this.updateSessionState(activeInput, selectionResponse);
        await this.syncConversationState(selectionResponse.callSessionId, deps);
        const meta = this.buildTurnMeta(callSessionId);
        await this.recordTurns(deps, activeInput, selectionResponse, meta);
        return selectionResponse;
      }
      const toolFlowStart = Date.now();
      const toolResponse = await this.handleToolCallingFlow(
        activeInput,
        deps,
        streamId,
      );
      const toolFlowMs = Date.now() - toolFlowStart;
      if (this.turnTimings) {
        this.turnTimings.toolFlowMs = toolFlowMs;
      }
      this.logger.info(
        {
          callSessionId,
          turnId: this.activeTurnId,
          toolFlowMs,
          handled: Boolean(toolResponse),
        },
        "conversation.session.step.tool_flow",
      );
      if (toolResponse) {
        this.emitEvent({ type: "final", data: toolResponse });
        await this.updateSessionState(activeInput, toolResponse);
        await this.syncConversationState(toolResponse.callSessionId, deps);
        const meta = this.buildTurnMeta(callSessionId);
        await this.recordTurns(deps, activeInput, toolResponse, meta);
        this.logger.info(
          {
            callSessionId,
            turnId: this.activeTurnId,
            replyLength: toolResponse.replyText.length,
            actions: toolResponse.actions,
          },
          "conversation.session.turn.complete",
        );
        return toolResponse;
      }
      const agentStart = Date.now();
      const response = await handleAgentMessage(deps, input, undefined, {
        onStatus: (status) => {
          const text = status.text.trim();
          if (!text || text === lastStatus) {
            return;
          }
          lastStatus = text;
          void this.emitNarratorStatus(
            activeInput,
            deps,
            streamId,
            text,
            "Acknowledge the request briefly while you check.",
          );
        },
        onToken: (token) => {
          if (this.canceledStreamIds.has(streamId)) {
            return;
          }
          this.recordTurnToken();
          this.emitEvent({ type: "token", text: token });
        },
      });
      const agentMs = Date.now() - agentStart;
      if (this.turnTimings) {
        this.turnTimings.agentMessageMs = agentMs;
      }
      this.logger.info(
        {
          callSessionId,
          turnId: this.activeTurnId,
          agentMessageMs: agentMs,
        },
        "conversation.session.step.agent_message",
      );
      if (!this.canceledStreamIds.has(streamId)) {
        this.emitEvent({ type: "final", data: response });
        await this.updateSessionState(input, response);
        await this.syncConversationState(response.callSessionId, deps);
        const meta = this.buildTurnMeta(callSessionId);
        await this.recordTurns(deps, activeInput, response, meta);
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
      if (this.turnMetrics && this.turnTimings) {
        this.turnTimings.totalMs =
          Date.now() - (this.turnMetrics.startedAt ?? Date.now());
      }
      const metrics = this.turnMetrics;
      const firstTokenMs =
        !metrics || metrics.firstTokenAt === null
          ? null
          : metrics.firstTokenAt - (metrics.startedAt ?? Date.now());
      const firstStatusMs =
        !metrics || metrics.firstStatusAt === null
          ? null
          : metrics.firstStatusAt - (metrics.startedAt ?? Date.now());
      this.logger.info(
        {
          callSessionId,
          first_token_ms: firstTokenMs,
          time_to_status_ms: firstStatusMs,
          total_ms: this.turnTimings?.totalMs ?? null,
        },
        "conversation.session.turn.latency",
      );
      this.turnMetrics = null;
      this.activeCallSessionId = null;
      this.activeTurnId = null;
      this.activeMessageId = null;
      this.activeStatusText = null;
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

    // All customer-facing text must be model-generated
    const contextHint = confirmed
      ? "Confirm you're canceling the appointment in a warm, helpful tone."
      : "Acknowledge that you won't cancel the appointment in a friendly tone.";
    const statusText =
      (await this.emitNarratorStatus(
        {
          callSessionId: sessionId,
          phoneNumber: this.sessionState.lastPhoneNumber ?? "unknown",
          text: confirmed ? "cancel confirmed" : "cancel declined",
        },
        deps,
        this.activeStreamId,
        "",
        contextHint,
      )) ?? "";
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
    // Emit status immediately to give user feedback while we fetch data
    this.emitEvent({
      type: "status",
      text: "Sure - I'm pulling your upcoming appointments now so we can pick the right one to cancel.",
    });
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
    // Emit status immediately to give user feedback while we fetch data
    this.emitEvent({
      type: "status",
      text: "Sure - I'm pulling your upcoming appointments now so we can pick the right one to reschedule.",
    });
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
    meta?: Record<string, unknown>,
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
        meta: { turnId: this.activeTurnId },
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
        meta: meta ?? {},
      });
    }
  }

  private async getRecentMessages(
    deps: ReturnType<typeof createDependencies>,
    callSessionId: string,
  ): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    const start = Date.now();
    const turns = await deps.calls.getRecentTurns({ callSessionId, limit: 10 });
    const messages = turns
      .filter((turn) => {
        // Include customer, agent, and status messages (status is what the bot said as acknowledgement)
        // Status messages are stored as speaker: "system" with kind: "status"
        const kind = (turn.meta as { kind?: string } | undefined)?.kind;
        const isStatus = kind === "status";
        // Include: customer messages, agent messages, and status messages
        return (
          turn.speaker === "customer" || turn.speaker === "agent" || isStatus
        );
      })
      .map((turn) => {
        // Map customer to user role, everything else (agent, status) to assistant
        const role = turn.speaker === "customer" ? "user" : "assistant";
        return { role: role as "user" | "assistant", content: turn.text };
      })
      .filter((turn) => turn.content.trim().length > 0);
    const chronological = messages;
    this.logger.info(
      {
        callSessionId,
        durationMs: Date.now() - start,
        messageCount: chronological.length,
        messages: chronological,
      },
      "conversation.session.messages.recent",
    );
    return chronological;
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

  private async classifyPendingIntent(
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
  ): Promise<SessionState["pendingIntent"] | null> {
    try {
      const model = await this.getModelAdapter(deps);
      const route = await model.route({
        text: input.text,
        customer: {
          id: "unknown",
          displayName: "Unknown caller",
          phoneE164: input.phoneNumber,
          addressSummary: "Unknown",
        },
        hasContext: Boolean(input.callSessionId),
        context: this.buildModelContext(),
        messages: await this.getRecentMessages(
          deps,
          input.callSessionId ?? crypto.randomUUID(),
        ),
      });
      if (route.intent && route.intent !== "general") {
        return { kind: route.intent, text: input.text };
      }
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : "unknown" },
        "conversation.session.pending_intent.classify_failed",
      );
    }
    return null;
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
      const pendingIntent =
        this.sessionState.pendingIntent ??
        (await this.classifyPendingIntent(input, deps));
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
        "Hi! Thanks for reaching out. To get started, can you share the 5-digit ZIP code on your account so I can pull up your details?",
        "Ask for the 5-digit ZIP code to verify the account in a friendly, conversational tone.",
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
        "Hi! Thanks for reaching out. To get started, can you share the 5-digit ZIP code on your account so I can pull up your details?",
        "Ask for the 5-digit ZIP code to verify the account in a friendly, conversational tone.",
      );
      const response: AgentMessageOutput = {
        callSessionId,
        replyText,
        actions: [],
      };
      return response;
    }
    await this.emitNarratorStatus(
      input,
      deps,
      streamId,
      "Thanks, I'll check that ZIP code now.",
      "Acknowledge that you're checking the ZIP code in a warm, conversational tone.",
    );
    const ok = await verifyAccount(deps.crm, customer.id, zipCode);
    if (ok) {
      await this.updateIdentitySummary(
        deps,
        callSessionId,
        input.phoneNumber,
        customer.id,
      );
      this.sessionState = {
        ...this.sessionState,
        conversation: applyIntent(state, {
          type: "verified",
          customerId: customer.id,
        }),
        pendingIntent: undefined,
      };
      await this.state.storage.put("state", this.sessionState);
      this.logger.info(
        {
          callSessionId,
          turnId: this.activeTurnId,
          verifiedCustomerId: customer.id,
          pendingIntentCleared: true,
        },
        "conversation.session.verification.completed",
      );
      // Continue to routing/workflows without emitting a standalone verification reply.
      return null;
    }
    const verificationText = ok
      ? "Thanks, I've got your account. What would you like to do next?"
      : "That ZIP does not match our records. Could you share the 5-digit ZIP code on the account?";
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

  // NOTE: Removed regex-based intent detection. The model will determine
  // intents through tool calls after verification is complete.
  private inferPendingIntent(
    _text: string,
  ): SessionState["pendingIntent"] | null {
    return null;
  }

  private async handlePendingIntent(
    intent: NonNullable<SessionState["pendingIntent"]>,
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
    streamId: number,
  ): Promise<string | null> {
    this.logger.info(
      {
        callSessionId: input.callSessionId ?? this.activeCallSessionId ?? null,
        pendingIntent: intent.kind,
      },
      "conversation.session.pending_intent.resume",
    );
    const callSessionId = input.callSessionId ?? crypto.randomUUID();
    if (!this.sessionState.conversation?.verification.customerId) {
      return null;
    }
    switch (intent.kind) {
      case "appointments": {
        await this.emitNarratorStatus(
          input,
          deps,
          streamId,
          "Looking up your appointments now.",
          "Acknowledge that you're looking up appointments.",
        );
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
              ? formatAppointmentsResponse(appointments)
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
          conversation: applyIntent(
            this.sessionState.conversation ?? initialConversationState(),
            { type: "schedule_requested" },
          ),
        };
        await this.state.storage.put("state", this.sessionState);
        return await this.narrateToolResult(
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
            deps,
            streamId,
            fallback: slots.length
              ? formatAvailableSlotsResponse(
                  slots,
                  "Is this for the same address we have on file?",
                )
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
              ? formatAppointmentsResponse(appointments)
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
        this.sessionState = {
          ...this.sessionState,
          conversation: applyIntent(
            this.sessionState.conversation ?? initialConversationState(),
            {
              type: "appointments_loaded",
              appointments: appointments.map((appointment) => ({
                id: appointment.id,
                date: appointment.date,
                timeWindow: appointment.timeWindow,
                addressSummary: appointment.addressSummary,
              })),
            },
          ),
        };
        await this.state.storage.put("state", this.sessionState);
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
              ? `${formatAppointmentsResponse(appointments)} Which one would you like to reschedule?`
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
              ? formatInvoicesResponse(invoices)
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

    // Determine expected selection kind from conversation state
    const expectedKind = this.getExpectedSelectionKind();

    this.logger.info(
      {
        callSessionId,
        turnId: this.activeTurnId,
        cancelWorkflowId: this.sessionState.cancelWorkflowId ?? null,
        rescheduleWorkflowId: this.sessionState.rescheduleWorkflowId ?? null,
        appointmentsCount:
          this.sessionState.conversation?.appointments.length ?? 0,
        availableSlotsCount: this.sessionState.availableSlots?.length ?? 0,
        inputText: input.text,
        expectedSelectionKind: expectedKind,
        conversationStatus: this.sessionState.conversation?.status ?? null,
      },
      "conversation.session.workflow.selection",
    );

    if (
      !this.sessionState.cancelWorkflowId &&
      !this.sessionState.rescheduleWorkflowId
    ) {
      return null;
    }

    const text = input.text.trim();

    // Check for context change (user wants to abort or start over)
    if (this.detectContextChange(text)) {
      await this.clearActiveSelection();
      // Let the tool calling flow handle the new intent
      return null;
    }

    // Clear stale selections
    if (this.isActiveSelectionStale()) {
      await this.clearActiveSelection();
    }

    // Build options based on current state
    const appointments =
      this.sessionState.conversation?.appointments ?? ([] as const);
    const appointmentOptions = appointments.map((appointment) => ({
      id: appointment.id,
      label: formatAppointmentLabel(appointment),
    }));
    const availableSlots = this.sessionState.availableSlots ?? [];
    const slotOptions = availableSlots.map((slot) => ({
      id: slot.id,
      label: formatSlotLabel(slot),
    }));
    const confirmationOptions = [
      { id: "confirm", label: "Yes, confirm" },
      { id: "decline", label: "No, do not change it" },
    ];

    // Try direct ID matching first (no LLM call needed)
    // cspell:ignore appt
    const appointmentIdMatch = text.match(/^appt_[\w-]+$/i);
    const slotIdMatch = text.match(/^slot_[\w-]+$/i);

    // Resolve selections based on expected kind - single LLM call
    let resolvedAppointmentId: string | null = null;
    let resolvedSlotId: string | null = null;
    let confirmation: boolean | null = null;

    // First try direct matching without LLM
    if (appointmentIdMatch) {
      resolvedAppointmentId = appointmentIdMatch[0];
    }
    if (slotIdMatch) {
      resolvedSlotId = slotIdMatch[0];
    }
    confirmation = this.parseConfirmation(text);

    // Only call LLM if we haven't resolved via direct matching and we have a clear expected kind
    if (
      expectedKind &&
      !appointmentIdMatch &&
      !slotIdMatch &&
      confirmation === null
    ) {
      switch (expectedKind) {
        case "confirmation": {
          const confirmationSelection = await this.selectOption(
            input,
            deps,
            "confirmation",
            confirmationOptions,
          );
          if (confirmationSelection === "confirm") {
            confirmation = true;
          } else if (confirmationSelection === "decline") {
            confirmation = false;
          }
          break;
        }
        case "appointment": {
          if (appointmentOptions.length) {
            resolvedAppointmentId = await this.selectOption(
              input,
              deps,
              "appointment",
              appointmentOptions,
            );
            if (!resolvedAppointmentId) {
              // Fallback to text-based resolution
              resolvedAppointmentId = this.resolveAppointmentSelection(
                text,
                appointments,
              );
            }
          }
          break;
        }
        case "slot": {
          if (slotOptions.length) {
            resolvedSlotId = await this.selectOption(
              input,
              deps,
              "slot",
              slotOptions,
            );
          }
          break;
        }
      }
    } else if (
      !expectedKind &&
      !appointmentIdMatch &&
      !slotIdMatch &&
      confirmation === null
    ) {
      // No clear expected kind from state - fallback to text-based resolution
      resolvedAppointmentId = this.resolveAppointmentSelection(
        text,
        appointments,
      );
    }

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
            fallback: formatAppointmentsResponse(appointments),
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
            conversation: applyIntent(
              this.sessionState.conversation ?? initialConversationState(),
              {
                type: "reschedule_requested",
                appointmentId: resolvedAppointmentId,
              },
            ),
          };
          await this.state.storage.put("state", this.sessionState);
          const replyText = await this.narrateToolResult(
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
              deps,
              streamId,
              fallback: slots.length
                ? formatAvailableSlotsResponse(slots, "Which one works best?")
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
          this.sessionState = {
            ...this.sessionState,
            conversation: applyIntent(
              this.sessionState.conversation ?? initialConversationState(),
              {
                type: "reschedule_slot_selected",
                slotId: resolvedSlotId,
              },
            ),
          };
          await this.state.storage.put("state", this.sessionState);
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
            conversation: applyIntent(
              this.sessionState.conversation ?? initialConversationState(),
              {
                type: confirmation
                  ? "reschedule_confirmed"
                  : "reschedule_declined",
              },
            ),
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
            fallback: formatAvailableSlotsResponse(
              availableSlots,
              "Which one works best?",
            ),
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
            fallback: formatAppointmentsResponse(appointments),
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
    // Parallelize pre-work: model adapter, customer context, and recent messages
    const preWorkStart = Date.now();
    const [model, customer, messages] = await Promise.all([
      this.getModelAdapter(deps),
      this.getCustomerContext(deps, input),
      this.getRecentMessages(deps, callSessionId),
    ]);
    const preWorkMs = Date.now() - preWorkStart;
    if (this.turnTimings) {
      this.turnTimings.preWorkMs = preWorkMs;
      // Keep individual timings as estimates (parallel execution)
      this.turnTimings.modelAdapterMs = preWorkMs;
      this.turnTimings.customerContextMs = preWorkMs;
      this.turnTimings.recentMessagesMs = preWorkMs;
    }
    const context = this.buildModelContext();
    try {
      this.recordModelCall("generate", model);
      this.logger.info(
        {
          callSessionId,
          turnId: this.activeTurnId,
          provider: model.name,
          modelId: model.modelId ?? null,
          kind: "generate",
        },
        "conversation.session.model.call",
      );
      this.logger.info(
        {
          callSessionId,
          turnId: this.activeTurnId,
          preWorkMs,
          messageCount: messages.length,
          messages,
        },
        "conversation.session.generate.input",
      );
      const generateStart = Date.now();
      const decision = await model.generate({
        text: input.text,
        customer,
        hasContext: Boolean(input.callSessionId),
        context,
        messages,
      });
      const generateMs = Date.now() - generateStart;
      if (this.turnTimings) {
        this.turnTimings.modelGenerateMs = generateMs;
      }
      this.logger.info(
        {
          callSessionId,
          turnId: this.activeTurnId,
          generateMs,
          decisionType: decision.type,
          toolName: "toolName" in decision ? decision.toolName : null,
          argKeys:
            decision.type === "tool_call"
              ? Object.keys(decision.arguments ?? {})
              : [],
          acknowledgementLength:
            "acknowledgement" in decision && decision.acknowledgement
              ? decision.acknowledgement.length
              : 0,
          finalLength: decision.type === "final" ? decision.text.length : 0,
        },
        "conversation.session.generate.output",
      );
      this.turnDecision = {
        decisionType: decision.type,
        toolName: "toolName" in decision ? decision.toolName : null,
        argKeys:
          decision.type === "tool_call"
            ? Object.keys(decision.arguments ?? {})
            : [],
        acknowledgementLength:
          "acknowledgement" in decision && decision.acknowledgement
            ? decision.acknowledgement.length
            : 0,
        finalLength: decision.type === "final" ? decision.text.length : 0,
      };
      if (decision.type === "final") {
        // Model decided not to call any tools - respect its decision
        const decisionText = decision.text.trim();
        const replyText = decisionText || INTERPRET_FALLBACK_TEXT;
        if (!decisionText) {
          this.logger.warn(
            {
              callSessionId,
              turnId: this.activeTurnId,
              inputLength: input.text?.length ?? 0,
              messageCount: messages.length,
              provider: model.name,
              modelId: model.modelId ?? null,
            },
            "conversation.session.final.empty_text",
          );
        }
        const debug = decisionText
          ? undefined
          : {
              reason: "empty_final_text",
              rawText: decision.text ?? null,
              provider: model.name,
              modelId: model.modelId ?? null,
              messageCount: messages.length,
            };
        this.logger.info(
          {
            callSessionId,
            turnId: this.activeTurnId,
            decisionType: "final",
            replyLength: replyText.length,
          },
          "conversation.session.final.no_tool",
        );
        this.emitNarratorTokens(replyText, streamId);
        return { callSessionId, replyText, actions: [], debug };
      }

      // Handle multiple tool calls in parallel
      if (isMultipleToolCalls(decision)) {
        const acknowledgementText = decision.acknowledgement?.trim() || "";
        if (acknowledgementText) {
          this.logger.info(
            {
              callSessionId,
              turnId: this.activeTurnId,
              callCount: decision.calls.length,
              toolNames: decision.calls.map((c) => c.toolName),
              acknowledgementLength: acknowledgementText.length,
            },
            "conversation.session.tool_calls.ack",
          );
          this.emitNarratorTokens(acknowledgementText, streamId);
        }
        return await this.executeMultipleToolCalls(
          decision,
          input,
          deps,
          streamId,
          callSessionId,
          acknowledgementText,
        );
      }

      // Handle single tool call (backwards compatible path)
      if (!isSingleToolCall(decision)) {
        // Should not reach here, but fallback for type safety
        const replyText = INTERPRET_FALLBACK_TEXT;
        const debug = {
          reason: "invalid_tool_decision",
          rawText:
            "type" in decision &&
            typeof (decision as { type?: unknown }).type === "string"
              ? (decision as { type?: string }).type
              : null,
          provider: model.name,
          modelId: model.modelId ?? null,
          messageCount: messages.length,
        };
        this.logger.warn(
          {
            callSessionId,
            turnId: this.activeTurnId,
            decisionType: (decision as { type?: string }).type ?? "unknown",
          },
          "conversation.session.tool_call.invalid_decision",
        );
        this.emitNarratorTokens(replyText, streamId);
        return { callSessionId, replyText, actions: [], debug };
      }

      const acknowledgementText = decision.acknowledgement?.trim() || "";
      if (acknowledgementText) {
        this.logger.info(
          {
            callSessionId,
            turnId: this.activeTurnId,
            toolName: decision.toolName,
            acknowledgementLength: acknowledgementText.length,
          },
          "conversation.session.tool_call.ack",
        );
        this.emitNarratorTokens(acknowledgementText, streamId);
        // Store acknowledgement as a status message so the narrator sees it
        // This prevents the narrator from repeating "I'm looking up..." phrasing
        await this.emitStatusText(
          callSessionId,
          input.phoneNumber,
          acknowledgementText,
          `ack-${decision.toolName}`,
        );
      }
      const actionPlan = actionPlanSchema.safeParse({
        kind: "tool",
        toolName: decision.toolName,
        arguments: decision.arguments ?? {},
        required: getActionPreconditions(decision.toolName),
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
      const policyGate = evaluateActionPlan(actionPlan.data, this.sessionState);
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
      this.logger.info(
        {
          callSessionId,
          turnId: this.activeTurnId,
          toolName: actionPlan.data.toolName,
          argKeys: Object.keys(actionPlan.data.arguments ?? {}),
        },
        "conversation.session.tool_call.start",
      );
      return await this.executeToolCall(
        actionPlan.data.toolName,
        actionPlan.data.arguments ?? {},
        input,
        deps,
        streamId,
        acknowledgementText,
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
          return `${index + 1}) ${formatAppointmentLabel(appointment)}`;
        })
        .join(" ");
      lines.push(`Cached appointments: ${summary}`);
    }
    if (this.sessionState.availableSlots?.length) {
      const summary = this.sessionState.availableSlots
        .map((slot, index) => `${index + 1}) ${formatSlotLabel(slot)}`)
        .join(" ");
      lines.push(`Cached available slots: ${summary}`);
    }
    return lines.join("\n");
  }

  private async executeToolCall(
    toolName: string,
    args: Record<string, unknown>,
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
    streamId: number,
    acknowledgementText?: string,
  ): Promise<AgentMessageOutput> {
    const callSessionId = input.callSessionId ?? crypto.randomUUID();
    const normalizedArgs = normalizeToolArgs(
      toolName,
      args,
      this.sessionState.conversation,
    ) as {
      appointmentId?: string;
      slotId?: string;
      reason?: string;
      summary?: string;
      customerId?: string;
    };
    this.turnToolCalls.push({
      toolName,
      argKeys: Object.keys(normalizedArgs ?? {}),
    });
    const toolAck = toolAcknowledgementSchema.safeParse(toolName);
    const toolAckConfig = toolAck.success
      ? getToolStatusConfig(toolAck.data)
      : null;
    const activeAcknowledgementText =
      acknowledgementText?.trim() ||
      toolAckConfig?.fallback ||
      DEFAULT_TOOL_STATUS_MESSAGE;

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
        const replyText = await this.narrateText(
          input,
          deps,
          streamId,
          startResult.message ?? "Cancellation is temporarily unavailable.",
          "Apologize and explain cancellation is unavailable right now.",
        );
        return {
          callSessionId,
          replyText: this.joinNarration(activeAcknowledgementText, replyText),
          actions: [],
        };
      }
      const appointments = startResult.appointments ?? [];
      if (!appointmentId) {
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
              ? formatAppointmentsResponse(appointments)
              : "I couldn't find any upcoming appointments to cancel.",
            contextHint: "Ask which appointment to cancel using the list.",
            priorAcknowledgement: acknowledgementText,
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(activeAcknowledgementText, replyText),
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
      const replyText = await this.narrateText(
        input,
        deps,
        streamId,
        "Confirm cancelling this appointment?",
        "Ask the customer to confirm cancelling the selected appointment.",
      );
      return {
        callSessionId,
        replyText: this.joinNarration(activeAcknowledgementText, replyText),
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
        const replyText = await this.narrateText(
          input,
          deps,
          streamId,
          startResult.message ?? "Rescheduling is temporarily unavailable.",
          "Apologize and explain rescheduling is unavailable right now.",
        );
        return {
          callSessionId,
          replyText: this.joinNarration(activeAcknowledgementText, replyText),
          actions: [],
        };
      }
      const appointments = startResult.appointments ?? [];
      if (!appointmentId) {
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
              ? `${formatAppointmentsResponse(appointments)} Which one would you like to reschedule?`
              : "I couldn't find any upcoming appointments to reschedule.",
            contextHint: "Ask which appointment to reschedule using the list.",
            priorAcknowledgement: acknowledgementText,
          },
        );
        this.sessionState = {
          ...this.sessionState,
          conversation: applyIntent(
            this.sessionState.conversation ?? initialConversationState(),
            {
              type: "appointments_loaded",
              appointments: appointments.map((appointment) => ({
                id: appointment.id,
                date: appointment.date,
                timeWindow: appointment.timeWindow,
                addressSummary: appointment.addressSummary,
              })),
            },
          ),
        };
        await this.state.storage.put("state", this.sessionState);
        return {
          callSessionId,
          replyText: this.joinNarration(activeAcknowledgementText, replyText),
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
          conversation: applyIntent(
            this.sessionState.conversation ?? initialConversationState(),
            {
              type: "reschedule_requested",
              appointmentId,
            },
          ),
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
              ? formatAvailableSlotsResponse(slots, "Which one works best?")
              : "I couldn't find any available times right now. Would you like me to check again later?",
            contextHint:
              "Offer available reschedule slots and ask which one they prefer.",
            priorAcknowledgement: acknowledgementText,
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(activeAcknowledgementText, replyText),
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
      this.sessionState = {
        ...this.sessionState,
        conversation: applyIntent(
          this.sessionState.conversation ?? initialConversationState(),
          {
            type: "reschedule_slot_selected",
            slotId,
          },
        ),
      };
      await this.state.storage.put("state", this.sessionState);
      const replyText = await this.narrateText(
        input,
        deps,
        streamId,
        "Confirm the new appointment time?",
        "Ask the customer to confirm the new appointment time.",
      );
      return {
        callSessionId,
        replyText: this.joinNarration(activeAcknowledgementText, replyText),
        actions: [],
      };
    }

    const validation = validateToolArgs(toolName as never, normalizedArgs);
    if (!validation.ok) {
      const replyText = await this.narrateText(
        input,
        deps,
        streamId,
        validation.message,
        "Ask the customer for the missing details.",
      );
      return {
        callSessionId,
        replyText: this.joinNarration(activeAcknowledgementText, replyText),
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
              ? formatAppointmentsResponse(appointments)
              : "I couldn't find any upcoming appointments. Would you like to schedule one?",
            contextHint: "Share upcoming appointments and ask next step.",
            priorAcknowledgement: acknowledgementText,
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
          replyText: this.joinNarration(activeAcknowledgementText, replyText),
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
              ? formatAppointmentsResponse([
                  {
                    id: appointment.id,
                    date: appointment.date,
                    timeWindow: appointment.timeWindow,
                    addressSummary: appointment.addressSummary,
                  },
                ])
              : "I couldn't find any upcoming appointments. Would you like to schedule one?",
            contextHint: "Share the next appointment details.",
            priorAcknowledgement: acknowledgementText,
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(activeAcknowledgementText, replyText),
          actions: [],
        };
      }
      case "crm.getAppointmentById": {
        const appointmentId = (validation.data as { appointmentId: string })
          .appointmentId;
        const appointment = await deps.crm.getAppointmentById(appointmentId);
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
              ? formatAppointmentsResponse([
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
            priorAcknowledgement: acknowledgementText,
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(activeAcknowledgementText, replyText),
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
              ? formatInvoicesResponse(invoices)
              : "You're all set. I don't see any open invoices right now.",
            contextHint: "Share the balance and invoice status.",
            priorAcknowledgement: acknowledgementText,
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(activeAcknowledgementText, replyText),
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
              ? formatAvailableSlotsResponse(slots, "Which one works best?")
              : "I couldn't find any available times right now. Would you like me to check again later?",
            contextHint:
              "Offer available times and confirm whether the on-file address is correct.",
            priorAcknowledgement: acknowledgementText,
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(activeAcknowledgementText, replyText),
          actions: [],
        };
      }
      case "crm.getServicePolicy": {
        const topic = (validation.data as { topic: string }).topic;
        const policyText = await getServicePolicy(deps.crm, topic);
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
            priorAcknowledgement: acknowledgementText,
          },
        );
        return {
          callSessionId,
          replyText: this.joinNarration(activeAcknowledgementText, replyText),
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
                priorAcknowledgement: acknowledgementText,
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
          replyText: this.joinNarration(activeAcknowledgementText, replyText),
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
            priorAcknowledgement: acknowledgementText,
          },
        );
        if (result.ok) {
          this.sessionState = {
            ...this.sessionState,
            conversation: applyIntent(
              this.sessionState.conversation ?? initialConversationState(),
              { type: "schedule_confirmed" },
            ),
          };
          await this.state.storage.put("state", this.sessionState);
        }
        return {
          callSessionId,
          replyText: this.joinNarration(activeAcknowledgementText, replyText),
          actions: [],
        };
      }
      case "agent.fallback": {
        const replyText = await this.narrateText(
          input,
          deps,
          streamId,
          "I can help with appointments, billing, or service questions. What can I do for you?",
          "Politely redirect to supported topics.",
        );
        return {
          callSessionId,
          replyText: this.joinNarration(activeAcknowledgementText, replyText),
          actions: [],
        };
      }
      default: {
        const replyText = await this.narrateText(
          input,
          deps,
          streamId,
          "I can help with appointments, billing, or service questions. What can I do for you?",
          "Politely redirect to supported topics.",
        );
        return {
          callSessionId,
          replyText: this.joinNarration(activeAcknowledgementText, replyText),
          actions: [],
        };
      }
    }
  }

  /** Read-only tools that can be safely executed in parallel */
  private static readonly PARALLELIZABLE_TOOLS = new Set([
    "crm.listUpcomingAppointments",
    "crm.getNextAppointment",
    "crm.getAppointmentById",
    "crm.getOpenInvoices",
    "crm.getAvailableSlots",
    "crm.getServicePolicy",
  ]);

  /** Maximum number of tools to execute in parallel */
  private static readonly MAX_PARALLEL_TOOLS = 3;

  /**
   * Executes multiple tool calls in parallel and combines results for narration.
   * Only parallelizes read-only tools; mutating tools are executed sequentially.
   */
  private async executeMultipleToolCalls(
    decision: {
      calls: Array<{ toolName: string; arguments?: Record<string, unknown> }>;
      acknowledgement?: string;
    },
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
    streamId: number,
    callSessionId: string,
    acknowledgementText: string,
  ): Promise<AgentMessageOutput> {
    const { calls } = decision;

    // Limit the number of parallel calls
    const limitedCalls = calls.slice(0, ConversationSession.MAX_PARALLEL_TOOLS);

    this.logger.info(
      {
        callSessionId,
        turnId: this.activeTurnId,
        totalCalls: calls.length,
        limitedCalls: limitedCalls.length,
        toolNames: limitedCalls.map((c) => c.toolName),
      },
      "conversation.session.tool_calls.start",
    );

    // Separate parallelizable and sequential tools
    const parallelizable = limitedCalls.filter((call) =>
      ConversationSession.PARALLELIZABLE_TOOLS.has(call.toolName),
    );
    const sequential = limitedCalls.filter(
      (call) => !ConversationSession.PARALLELIZABLE_TOOLS.has(call.toolName),
    );

    // Execute parallelizable tools in parallel
    const parallelResults = await Promise.allSettled(
      parallelizable.map((call) =>
        this.executeSingleToolForMulti(call, input, deps),
      ),
    );

    // Execute sequential/mutating tools one at a time
    const sequentialResults: Array<{
      toolName: string;
      result: ToolResult | null;
      error?: string;
    }> = [];
    for (const call of sequential) {
      try {
        const result = await this.executeSingleToolForMulti(call, input, deps);
        sequentialResults.push(result);
      } catch (error) {
        sequentialResults.push({
          toolName: call.toolName,
          result: null,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    // Combine all results
    const allResults: Array<{
      toolName: string;
      result: ToolResult | null;
      error?: string;
    }> = [
      ...parallelResults.map((settled, index) => {
        if (settled.status === "fulfilled") {
          return settled.value;
        }
        const call = parallelizable[index];
        return {
          toolName: call?.toolName ?? "unknown",
          result: null as ToolResult | null,
          error:
            settled.reason instanceof Error
              ? settled.reason.message
              : "unknown error",
        };
      }),
      ...sequentialResults,
    ];

    this.logger.info(
      {
        callSessionId,
        turnId: this.activeTurnId,
        successCount: allResults.filter((r) => r.result !== null).length,
        failureCount: allResults.filter((r) => r.result === null).length,
        toolNames: allResults.map((r) => r.toolName),
      },
      "conversation.session.tool_calls.complete",
    );

    // Narrate combined results
    return await this.narrateMultiToolResults(
      allResults,
      input,
      deps,
      streamId,
      callSessionId,
      acknowledgementText,
    );
  }

  /**
   * Executes a single tool for multi-tool flow (without narration).
   * Returns the raw tool result for later combined narration.
   */
  private async executeSingleToolForMulti(
    call: { toolName: string; arguments?: Record<string, unknown> },
    _input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
  ): Promise<{ toolName: string; result: ToolResult | null; error?: string }> {
    const normalizedArgs = normalizeToolArgs(
      call.toolName,
      call.arguments ?? {},
      this.sessionState.conversation,
    ) as {
      customerId?: string;
      appointmentId?: string;
    };

    const validation = validateToolArgs(call.toolName as never, normalizedArgs);
    if (!validation.ok) {
      return {
        toolName: call.toolName,
        result: null,
        error: validation.message,
      };
    }

    try {
      switch (call.toolName) {
        case "crm.listUpcomingAppointments": {
          const customerId =
            this.sessionState.conversation?.verification.customerId ?? "";
          const appointments = await listUpcomingAppointments(
            deps.crm,
            customerId,
          );
          return {
            toolName: call.toolName,
            result: {
              toolName: "crm.listUpcomingAppointments" as const,
              result: appointments.map((a) => ({
                id: a.id,
                customerId,
                date: a.date,
                timeWindow: a.timeWindow,
                addressSummary: a.addressSummary,
              })),
            },
          };
        }
        case "crm.getNextAppointment": {
          const customerId =
            this.sessionState.conversation?.verification.customerId ?? "";
          const appointments = await listUpcomingAppointments(
            deps.crm,
            customerId,
          );
          const appointment = appointments[0] ?? null;
          return {
            toolName: call.toolName,
            result: {
              toolName: "crm.getNextAppointment" as const,
              result: appointment
                ? {
                    date: appointment.date,
                    timeWindow: appointment.timeWindow,
                    addressSummary: appointment.addressSummary,
                  }
                : null,
            },
          };
        }
        case "crm.getOpenInvoices": {
          const customerId =
            this.sessionState.conversation?.verification.customerId ?? "";
          const invoices = await getOpenInvoices(deps.crm, customerId);
          const balanceCents = invoices.reduce(
            (sum, inv) => sum + (inv.balanceCents ?? 0),
            0,
          );
          const balance =
            invoices.find((inv) => inv.balance)?.balance ??
            (balanceCents / 100).toFixed(2);
          const currency = invoices.find((inv) => inv.currency)?.currency;
          return {
            toolName: call.toolName,
            result: {
              toolName: "crm.getOpenInvoices" as const,
              result: {
                balanceCents,
                balance,
                currency,
                invoiceCount: invoices.length,
              },
            },
          };
        }
        case "crm.getServicePolicy": {
          const topic = (normalizedArgs as { topic?: string }).topic ?? "";
          const policyText = await getServicePolicy(deps.crm, topic);
          return {
            toolName: call.toolName,
            result: {
              toolName: "crm.getServicePolicy" as const,
              result: { text: policyText },
            },
          };
        }
        case "crm.getAvailableSlots": {
          const customerId =
            this.sessionState.conversation?.verification.customerId ?? "";
          const slots = await getAvailableSlots(deps.crm, customerId, {
            daysAhead: 14,
          });
          return {
            toolName: call.toolName,
            result: {
              toolName: "crm.getAvailableSlots" as const,
              result: slots.map((s) => ({
                id: s.id,
                date: s.date,
                timeWindow: s.timeWindow,
              })),
            },
          };
        }
        case "crm.getAppointmentById": {
          const appointmentId = normalizedArgs.appointmentId ?? "";
          const appointment = await deps.crm.getAppointmentById(appointmentId);
          return {
            toolName: call.toolName,
            result: {
              toolName: "crm.getAppointmentById" as const,
              result: appointment
                ? {
                    date: appointment.date,
                    timeWindow: appointment.timeWindow,
                    addressSummary: appointment.addressSummary,
                  }
                : null,
            },
          };
        }
        default:
          return {
            toolName: call.toolName,
            result: null,
            error: `Tool ${call.toolName} not supported for parallel execution`,
          };
      }
    } catch (error) {
      return {
        toolName: call.toolName,
        result: null,
        error: error instanceof Error ? error.message : "unknown error",
      };
    }
  }

  /**
   * Narrates combined results from multiple tool calls.
   */
  private async narrateMultiToolResults(
    results: Array<{
      toolName: string;
      result: ToolResult | null;
      error?: string;
    }>,
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
    streamId: number,
    callSessionId: string,
    acknowledgementText: string,
  ): Promise<AgentMessageOutput> {
    // Build combined context for narration
    const successfulResults = results.filter((r) => r.result !== null);
    const failedResults = results.filter((r) => r.result === null);

    if (successfulResults.length === 0) {
      const replyText = await this.narrateText(
        input,
        deps,
        streamId,
        "I had trouble looking that up. Could you try asking again?",
        "Apologize and ask them to try again.",
      );
      return {
        callSessionId,
        replyText: this.joinNarration(acknowledgementText, replyText),
        actions: [],
      };
    }

    // Build combined tool results for narration
    const combinedResults = successfulResults
      .map((r) => {
        if (!r.result) return "";
        const resultData = r.result.result;
        switch (r.toolName) {
          case "crm.listUpcomingAppointments":
          case "crm.getNextAppointment":
            return `Appointments: ${JSON.stringify(resultData)}`;
          case "crm.getOpenInvoices":
            return `Billing: ${JSON.stringify(resultData)}`;
          case "crm.getServicePolicy":
            return `Policy: ${JSON.stringify(resultData)}`;
          case "crm.getAvailableSlots":
            return `Available slots: ${JSON.stringify(resultData)}`;
          default:
            return `${r.toolName}: ${JSON.stringify(resultData)}`;
        }
      })
      .filter(Boolean)
      .join("; ");

    // Build fallback text
    const fallbackParts: string[] = [];
    for (const r of successfulResults) {
      if (!r.result) continue;
      const resultData = r.result.result;
      switch (r.toolName) {
        case "crm.listUpcomingAppointments": {
          const appointments = resultData as Array<{
            id: string;
            date: string;
            timeWindow: string;
            addressSummary: string;
          }>;
          if (appointments.length) {
            fallbackParts.push(
              `You have ${appointments.length} upcoming appointment${appointments.length > 1 ? "s" : ""}.`,
            );
          } else {
            fallbackParts.push("You don't have any upcoming appointments.");
          }
          break;
        }
        case "crm.getOpenInvoices": {
          const invoices = resultData as {
            balanceCents: number;
            balance?: string;
            invoiceCount?: number;
          };
          if (invoices.balanceCents > 0) {
            fallbackParts.push(
              `Your current balance is $${invoices.balance ?? (invoices.balanceCents / 100).toFixed(2)}.`,
            );
          } else {
            fallbackParts.push("You're all set with no open balance.");
          }
          break;
        }
        case "crm.getServicePolicy": {
          const policy = resultData as { text: string };
          fallbackParts.push(policy.text);
          break;
        }
      }
    }

    if (failedResults.length > 0) {
      fallbackParts.push(
        `I couldn't get some information right now, but here's what I found.`,
      );
    }

    const fallbackText =
      fallbackParts.join(" ") || "Here's what I found for you.";

    // Use the first successful result's tool name for narration context
    // We know successfulResults[0] exists since we returned early if length === 0
    const primaryResult = successfulResults[0];
    if (!primaryResult || !primaryResult.result) {
      // This should not happen given the length check above, but satisfy TypeScript
      return {
        callSessionId,
        replyText: fallbackText,
        actions: [],
      };
    }
    const replyText = await this.narrateToolResult(primaryResult.result, {
      input,
      deps,
      streamId,
      fallback: fallbackText,
      contextHint: `Summarize these combined results naturally: ${combinedResults}`,
      priorAcknowledgement: acknowledgementText,
    });

    return {
      callSessionId,
      replyText: this.joinNarration(acknowledgementText, replyText),
      actions: [],
    };
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

  /**
   * Maps conversation status to the expected selection kind.
   * Returns null if no selection is expected in the current state.
   */
  private getExpectedSelectionKind():
    | "appointment"
    | "slot"
    | "confirmation"
    | null {
    const status = this.sessionState.conversation?.status;
    switch (status) {
      case "PresentingAppointments":
        return "appointment";
      case "PresentingSlots":
        return "slot";
      case "PendingCancellationConfirmation":
      case "PendingRescheduleConfirmation":
        return "confirmation";
      default:
        return null;
    }
  }

  /**
   * Detects if the user wants to change context or abort the current flow.
   */
  private detectContextChange(text: string): boolean {
    const patterns = [
      /\bnever ?mind\b/i,
      /\bcancel (that|this)\b/i,
      /\bstart over\b/i,
      /\bforget (it|that)\b/i,
      /\bactually,? ?(I want|let me|can we)\b/i,
    ];
    return patterns.some((p) => p.test(text));
  }

  /**
   * Clears the active selection state and persists to storage.
   */
  private async clearActiveSelection(): Promise<void> {
    if (!this.sessionState.activeSelection) {
      return;
    }
    this.sessionState = {
      ...this.sessionState,
      activeSelection: undefined,
    };
    await this.state.storage.put("state", this.sessionState);
  }

  /**
   * Sets the active selection state for tracking which selection we're waiting for.
   */
  private async setActiveSelection(
    kind: "appointment" | "slot" | "confirmation",
    options: Array<{ id: string; label: string }>,
    workflowType: "cancel" | "reschedule",
  ): Promise<void> {
    this.sessionState = {
      ...this.sessionState,
      activeSelection: {
        kind,
        options,
        presentedAt: Date.now(),
        workflowType,
      },
    };
    await this.state.storage.put("state", this.sessionState);
  }

  /**
   * Checks if the active selection is stale (older than 5 minutes).
   */
  private isActiveSelectionStale(): boolean {
    const selection = this.sessionState.activeSelection;
    if (!selection) {
      return false;
    }
    const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    return Date.now() - selection.presentedAt > STALE_TIMEOUT_MS;
  }

  private async getModelAdapter(
    deps: ReturnType<typeof createDependencies>,
  ): Promise<ReturnType<typeof deps.modelFactory>> {
    // Return cached model adapter if available (agent config doesn't change mid-session)
    if (this.cachedModelAdapter) {
      return this.cachedModelAdapter;
    }
    const agentConfig = await deps.agentConfig.get(deps.agentConfigDefaults);
    const model = deps.modelFactory(agentConfig);
    // Cache for future calls in this session
    this.cachedModelAdapter = model;
    this.logger.info(
      {
        callSessionId: this.activeCallSessionId,
        provider: model.name,
        modelId: model.modelId ?? null,
      },
      "conversation.session.model.selected",
    );
    return model;
  }

  private async getCustomerContext(
    deps: ReturnType<typeof createDependencies>,
    input: AgentMessageInput,
  ): Promise<AgentModelInput["customer"]> {
    // Return cached context if available (set after verification)
    if (this.cachedCustomerContext) {
      return this.cachedCustomerContext;
    }
    const customerId =
      this.sessionState.conversation?.verification.customerId ?? null;
    if (customerId) {
      const cached = await deps.customers.get(customerId);
      if (cached) {
        const context = {
          id: cached.id,
          displayName: cached.displayName,
          phoneE164: cached.phoneE164,
          addressSummary: cached.addressSummary ?? "the service address",
        };
        // Cache for future calls in this session
        this.cachedCustomerContext = context;
        return context;
      }
    }
    const matches = await deps.crm.lookupCustomerByPhone(input.phoneNumber);
    const match = Array.isArray(matches) ? matches[0] : null;
    if (match) {
      const context = {
        id: match.id,
        displayName: match.displayName,
        phoneE164: match.phoneE164,
        addressSummary: match.addressSummary,
      };
      // Cache for future calls in this session
      this.cachedCustomerContext = context;
      return context;
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
      priorAcknowledgement?: string;
    },
  ): Promise<string> {
    const {
      input,
      deps,
      streamId,
      fallback,
      contextHint,
      messages,
      priorAcknowledgement,
    } = options;
    const callSessionId =
      input.callSessionId ?? this.sessionState.lastCallSessionId ?? null;
    // Parallelize pre-work: model adapter, customer context, and recent messages
    const [model, customer, recentMessages] = await Promise.all([
      this.getModelAdapter(deps),
      this.getCustomerContext(deps, input),
      messages
        ? Promise.resolve(messages)
        : callSessionId
          ? this.getRecentMessages(deps, callSessionId)
          : Promise.resolve([]),
    ]);
    const respondInput: AgentResponseInput = {
      text: input.text,
      customer,
      hasContext: Boolean(input.callSessionId),
      context: contextHint,
      messages: recentMessages,
      priorAcknowledgement,
      ...toolResult,
    };
    this.recordModelCall("respond", model);
    this.logger.info(
      {
        callSessionId,
        provider: model.name,
        modelId: model.modelId ?? null,
        kind: "respond",
      },
      "conversation.session.model.call",
    );
    this.logger.info(
      {
        callSessionId,
        toolName: toolResult.toolName,
        messageCount: recentMessages.length,
        messages: recentMessages,
        contextHint: contextHint ?? null,
      },
      "conversation.session.narrate.input",
    );
    try {
      const respondStart = Date.now();
      let firstTokenMs: number | null = null;
      if (model.respondStream) {
        let combined = "";
        let waitingForJson = false;
        let checkedForJson = false;
        let tokenCount = 0;
        for await (const token of model.respondStream(respondInput)) {
          if (this.canceledStreamIds.has(streamId)) {
            this.logger.info(
              {
                callSessionId,
                toolName: toolResult.toolName,
                tokenCount,
                combinedLength: combined.length,
                waitingForJson,
                respondMs: Date.now() - respondStart,
                firstTokenMs,
                canceled: true,
              },
              "conversation.session.narrate.stream.end",
            );
            return sanitizeNarratorOutput(combined.trim()) || fallback;
          }
          combined += token;
          if (!checkedForJson) {
            const trimmed = combined.trimStart();
            if (trimmed) {
              checkedForJson = true;
              waitingForJson =
                trimmed.startsWith("{") || trimmed.startsWith("[");
              if (waitingForJson) {
                this.logger.info(
                  {
                    callSessionId,
                    toolName: toolResult.toolName,
                    prefix: trimmed.slice(0, 120),
                  },
                  "conversation.session.narrate.json_detected",
                );
              }
            }
          }
          if (!waitingForJson) {
            tokenCount += 1;
            if (firstTokenMs === null) {
              firstTokenMs = Date.now() - respondStart;
            }
            this.emitEvent({ type: "token", text: token });
          }
        }
        const sanitized = sanitizeNarratorOutput(combined.trim());
        if (waitingForJson && sanitized) {
          this.emitNarratorTokens(sanitized, streamId);
        }
        this.logger.info(
          {
            callSessionId,
            toolName: toolResult.toolName,
            tokenCount,
            combinedLength: combined.length,
            waitingForJson,
            sanitizedLength: sanitized.length,
            respondMs: Date.now() - respondStart,
            firstTokenMs,
          },
          "conversation.session.narrate.stream.end",
        );
        if (!tokenCount && !sanitized) {
          try {
            const directText = await model.respond(respondInput);
            const trimmed = sanitizeNarratorOutput(directText.trim());
            if (trimmed) {
              this.emitNarratorTokens(trimmed, streamId);
              this.logger.info(
                {
                  callSessionId,
                  toolName: toolResult.toolName,
                  textLength: trimmed.length,
                },
                "conversation.session.narrate.stream.fallback",
              );
              return trimmed;
            }
          } catch (error) {
            this.logger.error(
              { error: error instanceof Error ? error.message : "unknown" },
              "conversation.session.narrate.stream.fallback_failed",
            );
          }
        }
        return sanitized || fallback;
      }
      const text = await model.respond(respondInput);
      const trimmed = sanitizeNarratorOutput(text.trim());
      this.logger.info(
        {
          callSessionId,
          toolName: toolResult.toolName,
          respondMs: Date.now() - respondStart,
          textLength: trimmed.length,
        },
        "conversation.session.narrate.complete",
      );
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

  private recordModelCall(
    kind: "generate" | "respond" | "status",
    model: { name: string; modelId?: string | null },
  ) {
    this.turnModelCalls.push({
      kind,
      provider: model.name,
      modelId: model.modelId ?? null,
    });
  }

  private buildTurnMeta(callSessionId: string): Record<string, unknown> {
    const metrics = this.turnMetrics;
    const startedAt = metrics?.startedAt ?? Date.now();
    const firstTokenMs =
      !metrics || metrics.firstTokenAt === null
        ? null
        : metrics.firstTokenAt - startedAt;
    const firstStatusMs =
      !metrics || metrics.firstStatusAt === null
        ? null
        : metrics.firstStatusAt - startedAt;
    return {
      callSessionId,
      turnId: this.activeTurnId,
      streamId: this.activeStreamId,
      messageId: this.activeMessageId,
      modelCalls: [...this.turnModelCalls],
      decision: this.turnDecision,
      toolCalls: [...this.turnToolCalls],
      statusTexts: [...this.turnStatusTexts],
      timings: this.turnTimings ? { ...this.turnTimings } : null,
      latency: {
        firstTokenMs,
        firstStatusMs,
      },
    };
  }

  /**
   * Emits an early model-generated acknowledgement in parallel with main work.
   * This method is intentionally NOT awaited - it runs concurrently and emits
   * tokens as soon as the model returns. All acknowledgement text is model-generated
   * with appropriate context and tone.
   */
  private async emitEarlyAcknowledgement(
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
    streamId: number,
  ): Promise<void> {
    if (this.canceledStreamIds.has(streamId)) {
      return;
    }
    const callSessionId =
      input.callSessionId ?? this.activeCallSessionId ?? null;
    const ackStart = Date.now();
    try {
      // Parallelize pre-work: model adapter, messages, and customer context
      const [model, messages] = await Promise.all([
        this.getModelAdapter(deps),
        callSessionId
          ? this.getRecentMessages(deps, callSessionId)
          : Promise.resolve([]),
      ]);
      if (this.canceledStreamIds.has(streamId)) {
        return;
      }
      // Check if we've already emitted tokens - if so, skip the acknowledgement
      if (this.turnMetrics?.firstTokenAt !== null || this.statusSequence > 0) {
        return;
      }
      const context = this.buildModelContext();
      this.recordModelCall("status", model);
      this.logger.info(
        {
          callSessionId,
          provider: model.name,
          modelId: model.modelId ?? null,
          kind: "early_ack",
        },
        "conversation.session.model.call",
      );
      const statusText = await model.status({
        text: input.text,
        contextHint:
          "Acknowledge the request briefly and naturally while you check. Be friendly and conversational.",
        context,
        messages,
      });
      const ackMs = Date.now() - ackStart;
      this.logger.info(
        {
          callSessionId,
          ackMs,
          statusLength: statusText?.length ?? 0,
        },
        "conversation.session.early_ack.complete",
      );
      if (this.canceledStreamIds.has(streamId)) {
        return;
      }
      // Check again if we've already emitted tokens
      if (this.turnMetrics?.firstTokenAt !== null || this.statusSequence > 0) {
        return;
      }
      const trimmed = sanitizeNarratorOutput(statusText).trim();
      if (!trimmed) {
        return;
      }
      // Emit as tokens for streaming display
      this.emitNarratorTokens(trimmed, streamId);
      this.recordTurnToken();
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "conversation.session.early_ack.failed",
      );
      // Don't emit anything on failure - let the filler timer or main flow handle it
    }
  }

  private async emitNarratorStatus(
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
    streamId: number,
    fallback: string,
    contextHint?: string,
    correlationId?: string,
  ): Promise<string | null> {
    if (this.canceledStreamIds.has(streamId)) {
      return null;
    }
    const model = await this.getModelAdapter(deps);
    const callSessionId =
      input.callSessionId ?? this.activeCallSessionId ?? null;
    const messages = callSessionId
      ? await this.getRecentMessages(deps, callSessionId)
      : [];
    const context = this.buildModelContext();
    let statusText = fallback;
    try {
      const statusStart = Date.now();
      this.recordModelCall("status", model);
      this.logger.info(
        {
          callSessionId,
          provider: model.name,
          modelId: model.modelId ?? null,
          kind: "status",
        },
        "conversation.session.model.call",
      );
      this.logger.info(
        {
          callSessionId,
          messageCount: messages.length,
          messages,
          contextHint: contextHint ?? null,
        },
        "conversation.session.status.input",
      );
      statusText = await model.status({
        text: input.text,
        contextHint,
        context,
        messages,
      });
      this.logger.info(
        {
          callSessionId,
          statusMs: Date.now() - statusStart,
          statusLength: statusText?.length ?? 0,
        },
        "conversation.session.status.complete",
      );
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "conversation.session.status.failed",
      );
    }
    const trimmed = sanitizeNarratorOutput(statusText).trim();
    if (!trimmed) {
      return null;
    }
    await this.emitStatusText(
      callSessionId,
      input.phoneNumber,
      trimmed,
      correlationId,
    );
    return trimmed;
  }

  private async emitStatusText(
    callSessionId: string | null,
    phoneNumber: string,
    text: string,
    correlationId?: string,
  ): Promise<void> {
    if (!text) {
      return;
    }
    if (text === this.activeStatusText) {
      return;
    }
    this.activeStatusText = text;
    this.statusSequence += 1;
    this.turnStatusTexts = [...this.turnStatusTexts, text];
    this.emitEvent({
      type: "status",
      text,
      correlationId,
      role: "system",
    });
    if (callSessionId && phoneNumber) {
      const deps = createDependencies(this.env);
      await this.ensureCallSession(deps, callSessionId, phoneNumber);
      await deps.calls.addTurn({
        id: crypto.randomUUID(),
        callSessionId,
        ts: new Date().toISOString(),
        speaker: "system",
        text,
        meta: {
          kind: "status",
          correlationId: correlationId ?? null,
        },
      });
    }
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

  private emitEvent(event: Omit<ConversationEvent, "id" | "seq" | "at">): void {
    if (event.type === "token") {
      this.recordTurnToken();
    }
    if (event.type === "status") {
      this.recordTurnStatus();
    }
    const defaultRole =
      event.type === "status" ||
      event.type === "error" ||
      event.type === "resync" ||
      event.type === "speaking"
        ? "system"
        : "assistant";
    const enriched: ConversationEvent = {
      ...event,
      id: ++this.lastEventId,
      seq: this.lastEventId,
      turnId: event.turnId ?? this.activeTurnId,
      messageId: event.messageId ?? this.activeMessageId,
      role: event.role ?? defaultRole,
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
    event: Omit<ConversationEvent, "id" | "seq" | "at"> | ConversationEvent,
  ) {
    const payload =
      "id" in event && "at" in event
        ? event
        : {
            ...event,
            id: this.lastEventId,
            seq: this.lastEventId,
            turnId: event.turnId ?? this.activeTurnId,
            messageId: event.messageId ?? this.activeMessageId,
            role:
              event.role ??
              (event.type === "status" ||
              event.type === "error" ||
              event.type === "resync" ||
              event.type === "speaking"
                ? "system"
                : "assistant"),
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

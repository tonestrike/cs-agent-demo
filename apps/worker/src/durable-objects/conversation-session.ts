import { normalizePhoneE164 } from "@pestcall/core";

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
import {
  type AgentMessageInput,
  type AgentMessageOutput,
  agentMessageInputSchema,
} from "../schemas/agent";
import { handleAgentMessage } from "../use-cases/agent";
import {
  getOpenInvoices,
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

const MAX_EVENT_BUFFER = 200;

export class ConversationSession {
  private connections = new Set<WebSocket>();
  private logger: Logger;
  private eventBuffer: ConversationEvent[] = [];
  private lastEventId = 0;
  private speaking = false;
  private sessionState: SessionState = {};
  private activeStreamId = 0;
  private canceledStreamIds = new Set<number>();

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
    return Response.json(response);
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

  private async runMessage(
    input: AgentMessageInput,
  ): Promise<AgentMessageOutput> {
    const deps = createDependencies(this.env);
    const streamId = ++this.activeStreamId;
    this.canceledStreamIds.delete(streamId);
    await this.setSpeaking(true);
    let lastStatus = "";
    const turnStartedAt = Date.now();
    let firstTokenAt: number | null = null;
    let firstStatusAt: number | null = null;
    try {
      const verificationResponse = await this.handleVerificationGate(
        input,
        deps,
      );
      if (verificationResponse) {
        this.emitEvent({ type: "final", data: verificationResponse });
        await this.updateSessionState(input, verificationResponse);
        await this.syncConversationState(
          verificationResponse.callSessionId,
          deps,
        );
        return verificationResponse;
      }
      const workflowResponse = await this.handleWorkflowIntent(
        input,
        deps,
        streamId,
      );
      if (workflowResponse) {
        this.emitEvent({ type: "final", data: workflowResponse });
        await this.updateSessionState(input, workflowResponse);
        await this.syncConversationState(workflowResponse.callSessionId, deps);
        return workflowResponse;
      }
      const selectionResponse = await this.handleWorkflowSelection(
        input,
        deps,
        streamId,
      );
      if (selectionResponse) {
        this.emitEvent({ type: "final", data: selectionResponse });
        await this.updateSessionState(input, selectionResponse);
        await this.syncConversationState(selectionResponse.callSessionId, deps);
        return selectionResponse;
      }
      const escalationResponse = await this.handleEscalationFlow(input, deps);
      if (escalationResponse) {
        this.emitEvent({ type: "final", data: escalationResponse });
        await this.updateSessionState(input, escalationResponse);
        await this.syncConversationState(
          escalationResponse.callSessionId,
          deps,
        );
        return escalationResponse;
      }
      const billingResponse = await this.handleBillingFlow(input, deps);
      if (billingResponse) {
        this.emitEvent({ type: "final", data: billingResponse });
        await this.updateSessionState(input, billingResponse);
        await this.syncConversationState(billingResponse.callSessionId, deps);
        return billingResponse;
      }
      const appointmentResponse = await this.handleAppointmentsFlow(
        input,
        deps,
      );
      if (appointmentResponse) {
        this.emitEvent({ type: "final", data: appointmentResponse });
        await this.updateSessionState(input, appointmentResponse);
        await this.syncConversationState(
          appointmentResponse.callSessionId,
          deps,
        );
        return appointmentResponse;
      }
      const response = await handleAgentMessage(deps, input, undefined, {
        onStatus: (status) => {
          const text = status.text.trim();
          if (!text || text === lastStatus) {
            return;
          }
          if (firstStatusAt === null) {
            firstStatusAt = Date.now();
          }
          lastStatus = text;
          this.emitEvent({ type: "status", text });
        },
        onToken: (token) => {
          if (this.canceledStreamIds.has(streamId)) {
            return;
          }
          if (firstTokenAt === null) {
            firstTokenAt = Date.now();
          }
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
        callSessionId: input.callSessionId ?? crypto.randomUUID(),
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
      const firstTokenMs =
        firstTokenAt === null ? null : firstTokenAt - turnStartedAt;
      const firstStatusMs =
        firstStatusAt === null ? null : firstStatusAt - turnStartedAt;
      this.logger.info(
        {
          callSessionId: input.callSessionId ?? "new",
          first_token_ms: firstTokenMs,
          time_to_status_ms: firstStatusMs,
        },
        "conversation.session.turn.latency",
      );
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
  }): Promise<{ ok: boolean; message?: string }> {
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
    };
    await this.state.storage.put("state", this.sessionState);
    this.emitEvent({
      type: "status",
      text: "I'm pulling your upcoming appointments now.",
    });
    await this.syncConversationState(callSessionId, deps);
    return { ok: true, message: instance.id };
  }

  private async handleRescheduleStart(input: {
    callSessionId?: string;
    customerId?: string;
    phoneNumber?: string;
    message?: string;
  }): Promise<{ ok: boolean; message?: string }> {
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
    };
    await this.state.storage.put("state", this.sessionState);
    this.emitEvent({
      type: "status",
      text: "I'm pulling your upcoming appointments now.",
    });
    await this.syncConversationState(callSessionId, deps);
    return { ok: true, message: instance.id };
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
      const response: AgentMessageOutput = {
        callSessionId,
        replyText:
          "To get started, please share the 5-digit ZIP code on your account.",
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
      return {
        callSessionId,
        replyText:
          "To get started, please share the 5-digit ZIP code on your account.",
        actions: [],
      };
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
    const response: AgentMessageOutput = {
      callSessionId,
      replyText: ok
        ? "Thanks, you're verified. What would you like to do next?"
        : "That ZIP does not match our records. Please share the 5-digit ZIP code on your account.",
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

  private async handleEscalationFlow(
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
  ): Promise<AgentMessageOutput | null> {
    const state = this.sessionState.conversation ?? initialConversationState();
    if (!state.verification.verified) {
      return null;
    }
    const wantsEscalation =
      /\b(agent|human|representative|manager|supervisor|complaint|escalate)\b/i.test(
        input.text,
      );
    if (!wantsEscalation) {
      return null;
    }

    this.emitEvent({
      type: "status",
      text: "Connecting you to a specialist now.",
    });
    const result = await deps.crm.escalate({
      reason: "customer_request",
      summary: input.text,
      customerId: state.verification.customerId ?? undefined,
    });
    const callSessionId = input.callSessionId ?? crypto.randomUUID();
    const replyText = result.ok
      ? `I've asked a specialist to reach out. Your ticket ID is ${result.ticketId ?? "on file"}.`
      : "I'm sorry, I couldn't start an escalation right now. Please try again in a moment.";
    return {
      callSessionId,
      replyText,
      actions: [],
    };
  }

  private async handleAppointmentsFlow(
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
  ): Promise<AgentMessageOutput | null> {
    const state = this.sessionState.conversation ?? initialConversationState();
    if (!state.verification.verified || !state.verification.customerId) {
      return null;
    }
    const wantsAppointments =
      /\b(appointment|appointments|schedule|scheduled|when)\b/i.test(
        input.text,
      );
    if (!wantsAppointments) {
      return null;
    }

    this.emitEvent({
      type: "status",
      text: "Looking up your appointments now.",
    });
    const appointments = await listUpcomingAppointments(
      deps.crm,
      state.verification.customerId,
      3,
    );
    const callSessionId = input.callSessionId ?? crypto.randomUUID();
    await this.updateAppointmentSummary(
      deps,
      callSessionId,
      input.phoneNumber,
      appointments,
    );
    const replyText = appointments.length
      ? this.formatAppointmentsResponse(appointments)
      : "I couldn't find any upcoming appointments. Would you like to schedule one?";
    const response: AgentMessageOutput = {
      callSessionId,
      replyText,
      actions: [],
    };
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
    return response;
  }

  private async handleBillingFlow(
    input: AgentMessageInput,
    deps: ReturnType<typeof createDependencies>,
  ): Promise<AgentMessageOutput | null> {
    const state = this.sessionState.conversation ?? initialConversationState();
    if (!state.verification.verified || !state.verification.customerId) {
      return null;
    }
    const wantsBilling =
      /\b(bill|billing|invoice|payment|pay|balance|owe|owed)\b/i.test(
        input.text,
      );
    if (!wantsBilling) {
      return null;
    }

    this.emitEvent({ type: "status", text: "Checking your balance now." });
    const invoices = await getOpenInvoices(
      deps.crm,
      state.verification.customerId,
    );
    const callSessionId = input.callSessionId ?? crypto.randomUUID();
    const replyText = invoices.length
      ? this.formatInvoicesResponse(invoices)
      : "You're all set. I don't see any open invoices right now.";
    return {
      callSessionId,
      replyText,
      actions: [],
    };
  }

  private async handleWorkflowIntent(
    input: AgentMessageInput,
    _deps: ReturnType<typeof createDependencies>,
    streamId: number,
  ): Promise<AgentMessageOutput | null> {
    const state = this.sessionState.conversation ?? initialConversationState();
    if (!state.verification.verified || !state.verification.customerId) {
      return null;
    }
    const lowered = input.text.toLowerCase();
    const wantsCancel = /\bcancel\b/.test(lowered);
    const wantsReschedule =
      /\breschedul(e|ing)\b/.test(lowered) ||
      /\b(change|move)\b.*\bappointment\b/.test(lowered);
    if (!wantsCancel && !wantsReschedule) {
      return null;
    }

    if (wantsCancel) {
      const replyText =
        "Got it. I can help cancel that appointment. I'm pulling your upcoming appointments now.";
      this.emitNarratorTokens(replyText, streamId);
      const result = await this.handleCancelStart({
        callSessionId: input.callSessionId,
        customerId: state.verification.customerId ?? undefined,
        phoneNumber: input.phoneNumber,
        message: input.text,
      });
      return {
        callSessionId: input.callSessionId ?? crypto.randomUUID(),
        replyText: result.ok
          ? replyText
          : (result.message ?? "Cancellation is temporarily unavailable."),
        actions: [],
      };
    }

    const replyText =
      "Got it. I can help reschedule your appointment. I'm pulling your upcoming appointments now.";
    this.emitNarratorTokens(replyText, streamId);
    const result = await this.handleRescheduleStart({
      callSessionId: input.callSessionId,
      customerId: state.verification.customerId ?? undefined,
      phoneNumber: input.phoneNumber,
      message: input.text,
    });
    return {
      callSessionId: input.callSessionId ?? crypto.randomUUID(),
      replyText: result.ok
        ? replyText
        : (result.message ?? "Rescheduling is temporarily unavailable."),
      actions: [],
    };
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
    const text = input.text.trim();
    const confirmation = this.parseConfirmation(text);
    const appointmentIdMatch = text.match(/^appt_[\w-]+$/i);
    const slotIdMatch = text.match(/^slot_[\w-]+$/i);

    if (this.sessionState.cancelWorkflowId) {
      if (appointmentIdMatch) {
        const instance = await deps.workflows.cancel?.get(
          this.sessionState.cancelWorkflowId,
        );
        if (instance) {
          await instance.sendEvent({
            type: CANCEL_WORKFLOW_EVENT_SELECT_APPOINTMENT,
            payload: { appointmentId: appointmentIdMatch[0] },
          });
          const state =
            this.sessionState.conversation ?? initialConversationState();
          this.sessionState = {
            ...this.sessionState,
            conversation: applyIntent(state, {
              type: "cancel_requested",
              appointmentId: appointmentIdMatch[0],
            }),
          };
          await this.state.storage.put("state", this.sessionState);
          const replyText = "Confirm cancelling this appointment? (yes or no)";
          this.emitNarratorTokens(replyText, streamId);
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
          };
          await this.state.storage.put("state", this.sessionState);
          const replyText = confirmation
            ? "Thanks. I'll cancel that appointment now."
            : "Okay, I won't cancel that appointment.";
          this.emitNarratorTokens(replyText, streamId);
          return {
            callSessionId,
            replyText,
            actions: [],
          };
        }
      }
    }

    if (this.sessionState.rescheduleWorkflowId) {
      if (appointmentIdMatch) {
        const instance = await deps.workflows.reschedule?.get(
          this.sessionState.rescheduleWorkflowId,
        );
        if (instance) {
          await instance.sendEvent({
            type: RESCHEDULE_WORKFLOW_EVENT_SELECT_APPOINTMENT,
            payload: { appointmentId: appointmentIdMatch[0] },
          });
          const replyText =
            "Got it. Which new time works best? (share a slot id)";
          this.emitNarratorTokens(replyText, streamId);
          return {
            callSessionId,
            replyText,
            actions: [],
          };
        }
      }
      if (slotIdMatch) {
        const instance = await deps.workflows.reschedule?.get(
          this.sessionState.rescheduleWorkflowId,
        );
        if (instance) {
          await instance.sendEvent({
            type: RESCHEDULE_WORKFLOW_EVENT_SELECT_SLOT,
            payload: { slotId: slotIdMatch[0] },
          });
          const replyText = "Confirm the new appointment time? (yes or no)";
          this.emitNarratorTokens(replyText, streamId);
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
          const replyText = confirmation
            ? "Thanks. I'll finalize the reschedule now."
            : "Okay, I won't change the appointment.";
          this.emitNarratorTokens(replyText, streamId);
          return {
            callSessionId,
            replyText,
            actions: [],
          };
        }
      }
    }

    return null;
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
            callSessionId: this.sessionState.lastCallSessionId ?? "new",
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

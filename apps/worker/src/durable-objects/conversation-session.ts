import type { Env } from "../env";
import type { Logger } from "../logger";
import { createLogger } from "../logger";
import { createDependencies } from "../context";
import {
  applyIntent,
  conversationStateSchema,
  initialConversationState,
  type ConversationState,
} from "../conversation/state-machine";
import {
  deriveConversationStateFromSummary,
  type SummarySnapshot,
} from "../conversation/summary-state";
import { CANCEL_WORKFLOW_EVENT_CONFIRM } from "../workflows/constants";
import {
  type AgentMessageInput,
  type AgentMessageOutput,
  agentMessageInputSchema,
} from "../schemas/agent";
import { handleAgentMessage } from "../use-cases/agent";

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
    try {
      const response = await handleAgentMessage(deps, input, undefined, {
        onStatus: (status) => {
          const text = status.text.trim();
          if (!text || text === lastStatus) {
            return;
          }
          lastStatus = text;
          this.emitEvent({ type: "status", text });
        },
        onToken: (token) => {
          if (this.canceledStreamIds.has(streamId)) {
            return;
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
    message?: string;
  }): Promise<{ ok: boolean; message?: string }> {
    const deps = createDependencies(this.env);
    const callSessionId =
      input.callSessionId ?? this.sessionState.lastCallSessionId;
    if (!callSessionId) {
      return { ok: false, message: "No active session found." };
    }
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

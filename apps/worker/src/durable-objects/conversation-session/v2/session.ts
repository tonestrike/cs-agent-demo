/**
 * ConversationSession v2 - Main Session Class
 *
 * A generic, modular conversation session durable object.
 * All domain knowledge is injected via ToolProvider and PromptProvider.
 *
 * Key features:
 * - Acknowledgement messages before tool execution
 * - Streaming responses
 * - Fallback timeout handling (only fallback OR tool result, never both)
 * - Parallel tool execution
 * - Workflow state management
 */

import { runWithTools } from "@cloudflare/ai-utils";
import type {
  Ai,
  DurableObjectState,
  RoleScopedChatInput,
} from "@cloudflare/workers-types";
import { EventSourceParserStream } from "eventsource-parser/stream";
import type pino from "pino";
import type { Env } from "../../../env";
import {
  addRealtimeKitGuestParticipant,
  createRealtimeKitMeeting,
  getRealtimeKitConfigSummary,
  refreshRealtimeKitToken,
} from "../../../realtime-kit";
import { type ConnectionManager, createConnectionManager } from "./connection";
import { type EventEmitter, createEventEmitter } from "./events";
import { type StateManager, createStateManager } from "./state";
import {
  type ClientMessage,
  type Logger,
  type MessageInput,
  type MessageResult,
  type PromptProvider,
  type SessionConfig,
  type SessionDeps,
  type ToolContext,
  type ToolProvider,
  defaultSessionConfig,
} from "./types";

/** Message history entry */
type HistoryEntry = { role: "user" | "assistant"; content: string };

/** Turn tracking */
type TurnState = {
  turnId: number;
  messageId: string;
  startedAt: number;
  acknowledged: boolean;
  acknowledgementPrompts: string[];
  acknowledgementTask: Promise<void> | null;
  completed: boolean;
  fallbackTimer: ReturnType<typeof setTimeout> | null;
};

/**
 * ConversationSession v2
 *
 * A slim, generic coordinator that:
 * - Manages WebSocket connections
 * - Handles state persistence
 * - Routes messages to the model
 * - Emits events to clients
 *
 * No domain knowledge - all business logic lives in tools.
 */
export class ConversationSessionV2 {
  private state: StateManager;
  private events: EventEmitter;
  private connections: ConnectionManager;
  private logger: Logger;
  private config: SessionConfig;
  private ai: Ai | undefined;
  private toolProvider: ToolProvider;
  private promptProvider: PromptProvider;
  private env: Record<string, unknown>;
  private pendingCallSessionId: string | null = null;

  // Turn tracking
  private turnId = 0;
  private activeTurn: TurnState | null = null;
  private messageHistory: HistoryEntry[] = [];

  // Interruption handling (barge-in support)
  private activeStreamId = 0;
  private canceledStreamIds = new Set<number>();
  private speaking = false;

  // Fallback configuration
  private fallbackTimeoutMs = 8000;
  private fallbackMessage = "I'm still working on that. One moment please.";

  constructor(durableState: DurableObjectState, deps: SessionDeps) {
    this.logger = deps.logger;
    this.ai = deps.ai;
    this.toolProvider = deps.toolProvider;
    this.promptProvider = deps.promptProvider;
    this.env = deps.env;
    this.config = { ...defaultSessionConfig };

    // Create managers
    this.state = createStateManager(durableState, this.logger);
    this.events = createEventEmitter(this.logger, this.config.maxEventBuffer);
    this.connections = createConnectionManager(this.logger, this.events);

    // Set up message handler
    this.connections.setMessageHandler((msg) => this.handleMessage(msg));

    // Set up connect handler - send greeting when WebSocket connects
    this.connections.setConnectHandler(() => this.handleConnect());
  }

  /**
   * Handle fetch requests (HTTP and WebSocket upgrades).
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Load state on first request
    await this.state.load();

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      // Capture callSessionId from query and update meta so greeting can reset per call
      const callSessionId = url.searchParams.get("callSessionId") ?? undefined;
      this.pendingCallSessionId = callSessionId ?? null;
      if (callSessionId) {
        await this.state.updateMeta({ callSessionId });
      }
      return this.connections.handleUpgrade(request);
    }

    // HTTP routes - match on path ending to handle both /message and /conversation-session/message
    const pathname = url.pathname;

    if (pathname === "/health") {
      return this.handleHealth();
    }
    if (pathname === "/state") {
      return this.handleGetState();
    }
    if (pathname.endsWith("/message") && request.method === "POST") {
      return this.handleHttpMessage(request);
    }
    if (pathname.endsWith("/reset") && request.method === "POST") {
      return this.handleReset();
    }
    if (pathname.endsWith("/resync") && request.method === "POST") {
      return this.handleResync(request);
    }
    if (pathname.endsWith("/rtk-token") && request.method === "POST") {
      return this.handleRtkToken(request);
    }
    if (pathname.endsWith("/summary") && request.method === "GET") {
      return this.handleSummary(request);
    }
    if (pathname.endsWith("/debug") && request.method === "GET") {
      return this.handleDebug(request);
    }

    return new Response("Not Found", { status: 404 });
  }

  /**
   * Handle health check.
   */
  private handleHealth(): Response {
    return Response.json({
      ok: true,
      connections: this.connections.getConnectionCount(),
      turnId: this.turnId,
    });
  }

  /**
   * Handle state retrieval.
   */
  private handleGetState(): Response {
    return Response.json({
      state: this.state.get(),
      turnId: this.turnId,
      historyLength: this.messageHistory.length,
    });
  }

  /**
   * Handle HTTP message (for testing/debugging).
   */
  private async handleHttpMessage(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as {
        text: string;
        phoneNumber?: string;
        callSessionId?: string;
      };
      const result = await this.processMessage({
        text: body.text,
        phoneNumber: body.phoneNumber,
        callSessionId: body.callSessionId,
      });
      return Response.json(result);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "unknown" },
        { status: 500 },
      );
    }
  }

  /**
   * Handle session reset.
   */
  private async handleReset(): Promise<Response> {
    await this.state.reset();
    this.messageHistory = [];
    this.turnId = 0;
    this.activeTurn = null;
    this.events.clearBuffer();
    return Response.json({ ok: true });
  }

  /**
   * Handle resync request - replay events since lastEventId.
   */
  private async handleResync(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as { lastEventId?: number };
      const lastEventId = body.lastEventId ?? 0;
      const events = this.events.getEventsSince(lastEventId);
      return Response.json({
        ok: true,
        events,
        speaking: false,
        latestEventId: this.events.getCurrentEventId(),
      });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "unknown",
        },
        { status: 500 },
      );
    }
  }

  /**
   * Handle RTK token request.
   * Creates or refreshes RealtimeKit participant tokens for real-time communication.
   */
  private async handleRtkToken(request: Request): Promise<Response> {
    // Cast to typed versions once at the top
    const env = this.env as unknown as Env;
    const logger = this.logger as unknown as pino.Logger;

    // Check if RTK is configured
    if (
      !env.REALTIMEKIT_API_TOKEN ||
      !env.REALTIMEKIT_ACCOUNT_ID ||
      !env.REALTIMEKIT_APP_ID
    ) {
      return Response.json(
        { ok: false, error: "RealtimeKit not configured" },
        { status: 501 },
      );
    }

    logger.info(
      { config: getRealtimeKitConfigSummary(env) },
      "session.v2.rtk_config",
    );

    const url = new URL(request.url);
    const sessionState = this.state.get();
    const domainState = (sessionState.domainState ?? {}) as {
      rtkMeetingId?: string;
      rtkGuestParticipantId?: string;
      rtkGuestCustomId?: string;
      rtkCallSessionId?: string;
    };

    // Get current call session ID from query param or state
    const currentCallSessionId =
      url.searchParams.get("callSessionId") ?? sessionState.callSessionId;

    try {
      // Get or create meeting
      const meetingId =
        domainState.rtkMeetingId ??
        (await createRealtimeKitMeeting(env, logger));

      const storedRtkCallSessionId = domainState.rtkCallSessionId;
      const storedMeetingId = domainState.rtkMeetingId;
      const needsFreshParticipant =
        currentCallSessionId !== storedRtkCallSessionId ||
        Boolean(storedMeetingId && storedMeetingId !== meetingId);

      logger.info(
        {
          currentCallSessionId,
          storedRtkCallSessionId,
          meetingId,
          storedMeetingId,
          needsFreshParticipant,
          hasExistingParticipant: Boolean(domainState.rtkGuestParticipantId),
        },
        "session.v2.rtk_token_check",
      );

      // Try to refresh existing participant if same call session
      const guestParticipantId = domainState.rtkGuestParticipantId;
      if (guestParticipantId && !needsFreshParticipant) {
        try {
          const token = await refreshRealtimeKitToken(
            env,
            guestParticipantId,
            logger,
            { meetingId },
          );
          return Response.json({ ok: true, ...token });
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown";
          logger.warn(
            { error: message, participantId: guestParticipantId },
            "session.v2.rtk_guest_refresh_failed",
          );
        }
      }

      // New call session - reset conversation state
      if (needsFreshParticipant) {
        logger.info(
          { currentCallSessionId, storedRtkCallSessionId },
          "session.v2.new_call_session",
        );
        // Clear greeting flag so greeting is sent for new call
        // Clear message history for fresh conversation
        this.messageHistory = [];
        this.turnId = 0;
        await this.state.updateDomain({
          greetingSent: false,
          // Clear any stale workflow state
          rescheduleWorkflowId: undefined,
          cancelWorkflowId: undefined,
          activeSelection: undefined,
        });
      }

      // Create a new guest participant with unique ID per call session
      const phoneNumber = sessionState.phoneNumber;
      const callId = currentCallSessionId ?? crypto.randomUUID();
      const uniqueId = `${callId}:${Date.now()}`;
      const customParticipantId = `session:${uniqueId}`;
      const displayName = phoneNumber ? `Caller ${phoneNumber}` : "Caller";

      const token = await addRealtimeKitGuestParticipant(
        env,
        { displayName, customParticipantId },
        logger,
        { meetingId },
      );

      // Update domain state with RTK info
      await this.state.updateDomain({
        rtkGuestParticipantId: token.participantId,
        rtkGuestCustomId: customParticipantId,
        rtkCallSessionId: currentCallSessionId,
        rtkMeetingId: meetingId,
      });

      return Response.json({ ok: true, ...token });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "RealtimeKit token failed.";
      logger.error({ error: message }, "session.v2.rtk_token_failed");
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }

  /**
   * Handle summary request.
   */
  private async handleSummary(_request: Request): Promise<Response> {
    const state = this.state.get();
    return Response.json({
      ok: true,
      callSessionId: state.callSessionId,
      summary: {
        messageCount: this.messageHistory.length,
        domainState: state.domainState,
        lastActivityAt: state.lastActivityAt,
      },
    });
  }

  /**
   * Handle debug request.
   */
  private async handleDebug(_request: Request): Promise<Response> {
    const state = this.state.get();
    return Response.json({
      ok: true,
      sessionState: state,
      turnId: this.turnId,
      activeTurn: this.activeTurn,
      historyLength: this.messageHistory.length,
      eventBuffer: this.events.getAllEvents().slice(-50),
      connections: this.connections.getConnectionCount(),
    });
  }

  /**
   * Handle WebSocket connection.
   * Sends greeting if not already sent for this session.
   */
  private async handleConnect(): Promise<void> {
    // Load state to check if greeting was sent
    let sessionState = this.state.get();
    const incomingCallSessionId = this.pendingCallSessionId;
    this.pendingCallSessionId = null;

    // If we detect a new call session, reset greeting and history
    if (
      incomingCallSessionId &&
      incomingCallSessionId !== sessionState.callSessionId
    ) {
      this.logger.info(
        {
          incomingCallSessionId,
          storedCallSessionId: sessionState.callSessionId,
        },
        "session.new_call_session_on_connect",
      );
      this.messageHistory = [];
      this.turnId = 0;
      await this.state.updateMeta({ callSessionId: incomingCallSessionId });
      await this.state.updateDomain({
        greetingSent: false,
        rescheduleWorkflowId: undefined,
        cancelWorkflowId: undefined,
        activeSelection: undefined,
      });
      sessionState = this.state.get();
    }

    const greetingSent = Boolean(
      sessionState.domainState["greetingSent"] as boolean | undefined,
    );

    if (greetingSent) {
      this.logger.debug({}, "session.greeting_already_sent");
      return;
    }

    // Send greeting
    await this.sendGreeting();
  }

  /**
   * Handle incoming client message (from WebSocket).
   */
  private async handleMessage(message: ClientMessage): Promise<void> {
    // Handle barge-in request
    if (message.type === "barge_in") {
      await this.handleBargeIn();
      return;
    }

    if (message.type !== "message" && message.type !== "final_transcript") {
      return;
    }

    if (!message.text?.trim()) {
      return;
    }

    await this.processMessage({
      text: message.text,
      phoneNumber: message.phoneNumber,
      callSessionId: message.callSessionId,
    });
  }

  /**
   * Process a user message through the agent loop.
   */
  async processMessage(input: MessageInput): Promise<MessageResult> {
    // Handle barge-in: if already speaking, cancel current stream
    if (this.speaking) {
      await this.handleBargeIn();
    }

    // Update session metadata
    await this.state.updateMeta({
      phoneNumber: input.phoneNumber,
      callSessionId: input.callSessionId,
    });

    // Create new stream ID for this turn
    const streamId = ++this.activeStreamId;
    this.canceledStreamIds.delete(streamId);

    // Create turn
    const turn = this.createTurn();
    this.activeTurn = turn;

    // Mark as speaking
    await this.setSpeaking(true);

    this.logger.info(
      { turnId: turn.turnId, streamId, text: input.text.slice(0, 50) },
      "session.message_received",
    );

    // Add to history
    this.messageHistory.push({ role: "user", content: input.text });
    this.trimHistory();

    // Start fallback timer
    this.startFallbackTimer(turn);

    try {
      // Process with model
      const response = await this.runAgentLoop(input, turn, streamId);

      // Cancel fallback timer
      this.cancelFallbackTimer(turn);

      // Mark complete
      turn.completed = true;

      // Add to history
      this.messageHistory.push({ role: "assistant", content: response });

      // Emit final
      this.events.emitFinal(response, {
        turnId: turn.turnId,
        messageId: turn.messageId,
      });

      this.logger.info(
        { turnId: turn.turnId, responseLength: response.length },
        "session.message_complete",
      );

      return {
        response,
        streamed: true,
        toolCallCount: 0, // TODO: Track from agent loop
        turnId: turn.turnId,
        messageId: turn.messageId,
      };
    } catch (error) {
      this.cancelFallbackTimer(turn);
      turn.completed = true;

      const errorMessage = "I encountered an issue. Please try again.";
      this.events.emitError(errorMessage, { turnId: turn.turnId });

      this.logger.error(
        {
          turnId: turn.turnId,
          error: error instanceof Error ? error.message : "unknown",
        },
        "session.message_error",
      );

      return {
        response: errorMessage,
        streamed: false,
        toolCallCount: 0,
        turnId: turn.turnId,
        messageId: turn.messageId,
      };
    } finally {
      this.activeTurn = null;
      // Mark as done speaking
      await this.setSpeaking(false);
    }
  }

  /**
   * Run the agent loop with tools.
   */
  private async runAgentLoop(
    input: MessageInput,
    turn: TurnState,
    streamId: number,
  ): Promise<string> {
    if (!this.ai) {
      this.logger.warn({}, "session.no_ai_binding");
      return "AI is not available. Please try again later.";
    }

    const sessionState = this.state.get();

    // Build system prompt via provider (async for RAG retrieval)
    const systemPrompt = await this.promptProvider.buildSystemPrompt(
      sessionState,
      input.text,
    );

    // Build messages
    const messages: RoleScopedChatInput[] = [
      { role: "system", content: systemPrompt },
      ...this.messageHistory.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    // Build tool context
    const toolContext: ToolContext = {
      sessionState,
      updateState: async (updates) => {
        await this.state.updateDomain(updates);
      },
      logger: this.logger,
      input,
    };

    // Get tools from provider
    const tools = this.toolProvider.getTools(sessionState);

    // Build tools for runWithTools
    const toolsForModel = tools.map((tool) => ({
      name: tool.definition.name,
      description: tool.definition.description,
      parameters: tool.definition.parameters,
      function: async (args: Record<string, unknown>): Promise<string> => {
        // Queue acknowledgement prompt for aggregation
        // Note: Tools that shouldn't have acknowledgements (like verification)
        // should not define an acknowledgement in their tool definition
        if (tool.definition.acknowledgement) {
          turn.acknowledgementPrompts.push(tool.definition.acknowledgement);
        }

        // Emit aggregated acknowledgement once per turn (only if at least one prompt)
        if (
          !turn.acknowledged &&
          turn.acknowledgementPrompts.length > 0 &&
          !turn.acknowledgementTask
        ) {
          turn.acknowledged = true;
          turn.acknowledgementTask = this.emitAggregatedAcknowledgement(turn);
        }

        this.logger.info(
          { toolName: tool.definition.name, turnId: turn.turnId },
          "session.tool_call",
        );

        try {
          const result = await tool.execute(args, toolContext);
          return JSON.stringify(result);
        } catch (error) {
          this.logger.error(
            {
              toolName: tool.definition.name,
              error: error instanceof Error ? error.message : "unknown",
            },
            "session.tool_error",
          );
          return JSON.stringify({ error: "Tool execution failed" });
        }
      },
    }));

    // Run with tools - streaming enabled for RTK
    const response = await runWithTools(
      this.ai,
      this.config.model as Parameters<typeof runWithTools>[1],
      { messages, tools: toolsForModel },
      {
        maxRecursiveToolRuns: this.config.maxToolRuns,
        streamFinalResponse: true,
        verbose: this.config.verbose,
      },
    );

    // Handle streaming response
    if (this.isReadableStream(response)) {
      return this.handleStreamingResponse(response, turn, streamId);
    }

    // Fallback to non-streaming response extraction
    return this.extractResponseText(response);
  }

  /**
   * Check if a value is a ReadableStream.
   */
  private isReadableStream(value: unknown): value is ReadableStream {
    return (
      typeof value === "object" &&
      value !== null &&
      "getReader" in value &&
      typeof (value as ReadableStream).getReader === "function"
    );
  }

  /**
   * Handle streaming response from the model.
   * Uses EventSourceParserStream for proper SSE parsing.
   * Emits tokens as they arrive and collects the full response.
   */
  private async handleStreamingResponse(
    stream: ReadableStream,
    turn: TurnState,
    streamId: number,
  ): Promise<string> {
    let fullResponse = "";

    try {
      // Pipe through TextDecoder and EventSourceParser
      const eventStream = stream
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream());

      const reader = eventStream.getReader();

      while (true) {
        // Check for barge-in cancellation
        if (this.isStreamCanceled(streamId)) {
          this.logger.info(
            {
              turnId: turn.turnId,
              streamId,
              partialLength: fullResponse.length,
            },
            "session.streaming_canceled",
          );
          break;
        }

        const { done, value: event } = await reader.read();
        if (done) break;

        // event is EventSourceMessage with .data (always present), .event, .id
        if (event.data) {
          // Skip [DONE] marker
          if (event.data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(event.data) as {
              response?: string;
              tool_calls?: unknown[];
            };

            if (parsed.response) {
              fullResponse += parsed.response;

              // Emit token if not canceled
              if (!this.isStreamCanceled(streamId)) {
                this.events.emitToken(parsed.response, {
                  turnId: turn.turnId,
                  messageId: turn.messageId,
                });
              }
            }
          } catch {
            this.logger.debug(
              { data: event.data.slice(0, 50) },
              "session.streaming_parse_skip",
            );
          }
        }
      }

      reader.releaseLock();

      this.logger.info(
        { turnId: turn.turnId, responseLength: fullResponse.length },
        "session.streaming_complete",
      );

      return fullResponse.trim();
    } catch (error) {
      this.logger.error(
        {
          turnId: turn.turnId,
          error: error instanceof Error ? error.message : "unknown",
        },
        "session.streaming_error",
      );

      // Return what we have so far
      if (fullResponse) {
        return fullResponse.trim();
      }

      throw error;
    }
  }

  /**
   * Extract text from model response.
   */
  private extractResponseText(response: unknown): string {
    if (typeof response === "string") {
      return response.trim();
    }

    if (response && typeof response === "object") {
      if ("response" in response && typeof response.response === "string") {
        return response.response.trim();
      }
      if (
        "choices" in response &&
        Array.isArray(response.choices) &&
        response.choices[0]?.message?.content
      ) {
        return response.choices[0].message.content.trim();
      }
    }

    return "I'm not sure how to respond to that.";
  }

  /**
   * Create a new turn.
   */
  private createTurn(): TurnState {
    return {
      turnId: ++this.turnId,
      messageId: crypto.randomUUID(),
      startedAt: Date.now(),
      acknowledged: false,
      acknowledgementPrompts: [],
      acknowledgementTask: null,
      completed: false,
      fallbackTimer: null,
    };
  }

  /**
   * Start fallback timer for a turn.
   * If the turn doesn't complete in time, emit a fallback message.
   */
  private startFallbackTimer(turn: TurnState): void {
    turn.fallbackTimer = setTimeout(() => {
      if (!turn.completed && !turn.acknowledged) {
        this.events.emitStatus(this.fallbackMessage, { turnId: turn.turnId });
        turn.acknowledged = true;
        this.logger.info({ turnId: turn.turnId }, "session.fallback_triggered");
      }
    }, this.fallbackTimeoutMs);
  }

  /**
   * Cancel fallback timer.
   */
  private cancelFallbackTimer(turn: TurnState): void {
    if (turn.fallbackTimer) {
      clearTimeout(turn.fallbackTimer);
      turn.fallbackTimer = null;
    }
  }

  /**
   * Emit an aggregated acknowledgement using the model.
   * Combines multiple tool acknowledgements into a single warm, natural message.
   */
  private async emitAggregatedAcknowledgement(turn: TurnState): Promise<void> {
    const prompts = [...turn.acknowledgementPrompts];
    if (prompts.length === 0) return;

    // Fallback if only one prompt or no AI
    const fallbackAck =
      prompts.length === 1
        ? prompts[0]
        : "One moment while I look that up for you...";

    if (!this.ai) {
      this.events.emitStatus(fallbackAck ?? "One moment...", {
        turnId: turn.turnId,
      });
      return;
    }

    // Build a clear prompt for acknowledgement generation
    const systemPromptLines = [
      "You are a friendly customer service agent. Generate a single, brief acknowledgement message to let the customer know you're working on their request.",
      "",
      "## Rules",
      "- Write exactly ONE short sentence (under 100 characters)",
      "- Be warm and reassuring",
      "- Use natural conversational language",
      "- Do NOT ask any questions",
      "- Do NOT make promises about specific outcomes",
      '- Do NOT use filler words like "certainly" or "absolutely"',
      "",
      "## Examples",
      '- "Let me pull that up for you."',
      '- "One moment while I check on that."',
      '- "Got it—looking into that now."',
      '- "Let me check your account and appointments."',
    ];
    const systemPrompt = systemPromptLines.join("\n");

    const userPrompt =
      prompts.length === 1
        ? `Write an acknowledgement for: ${prompts[0]}`
        : `Write a single acknowledgement that covers all of these actions:\n${prompts.map((p) => `- ${p}`).join("\n")}`;

    try {
      // Use non-streaming to get the complete response
      const response = await runWithTools(
        this.ai,
        this.config.model as Parameters<typeof runWithTools>[1],
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools: [],
        },
        { streamFinalResponse: false, maxRecursiveToolRuns: 0 },
      );

      const text = this.extractResponseText(response).replace(
        /^["']|["']$/g,
        "",
      );

      // Validate the response is reasonable
      if (text && text.length > 5 && text.length < 150) {
        this.logger.debug(
          {
            turnId: turn.turnId,
            acknowledgement: text,
            promptCount: prompts.length,
          },
          "session.acknowledgement_sent",
        );
        this.events.emitStatus(text, { turnId: turn.turnId });
      } else {
        this.events.emitStatus(fallbackAck ?? "One moment...", {
          turnId: turn.turnId,
        });
      }
    } catch (error) {
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : "unknown",
          prompts: prompts.slice(0, 3),
        },
        "session.acknowledgement_generate_failed",
      );
      this.events.emitStatus(fallbackAck ?? "One moment...", {
        turnId: turn.turnId,
      });
    }
  }

  /**
   * Trim message history to prevent unbounded growth.
   */
  private trimHistory(maxMessages = 20): void {
    if (this.messageHistory.length > maxMessages) {
      this.messageHistory = this.messageHistory.slice(-maxMessages);
    }
  }

  /**
   * Send the initial greeting message.
   * Called automatically when WebSocket connects (if not already sent).
   */
  private async sendGreeting(): Promise<void> {
    const greeting = this.promptProvider.getGreeting();
    const messageId = crypto.randomUUID();

    this.logger.info(
      { greeting: greeting.slice(0, 50) },
      "session.greeting_sent",
    );

    // Add greeting to history as assistant message
    this.messageHistory.push({ role: "assistant", content: greeting });

    // Mark greeting as sent in domain state
    await this.state.updateDomain({ greetingSent: true });

    // Emit greeting to connected clients
    this.events.emitFinal(greeting, { turnId: 0, messageId });
  }

  /**
   * Configure the session.
   */
  configure(config: Partial<SessionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set fallback timeout.
   */
  setFallbackTimeout(ms: number): void {
    this.fallbackTimeoutMs = ms;
  }

  /**
   * Set fallback message.
   */
  setFallbackMessage(message: string): void {
    this.fallbackMessage = message;
  }

  /**
   * Get current state (for inspection).
   */
  getState() {
    return this.state.get();
  }

  /**
   * Get message history (for inspection).
   */
  getHistory(): HistoryEntry[] {
    return [...this.messageHistory];
  }

  /**
   * Update speaking state.
   * Emits speaking event to clients and persists to storage.
   */
  private async setSpeaking(value: boolean): Promise<void> {
    if (this.speaking === value) return;
    this.speaking = value;
    await this.state.updateDomain({ speaking: value });
    this.events.emitSpeaking(value);
  }

  /**
   * Handle barge-in (user interruption).
   * Cancels the current stream and stops speaking.
   */
  private async handleBargeIn(): Promise<void> {
    const streamId = this.activeStreamId;
    this.canceledStreamIds.add(streamId);
    this.logger.info({ streamId }, "session.barge_in");
    await this.setSpeaking(false);
  }

  /**
   * Check if a stream is canceled.
   */
  private isStreamCanceled(streamId: number): boolean {
    return this.canceledStreamIds.has(streamId);
  }
}

/**
 * Builder for creating ConversationSessionV2 instances.
 *
 * Usage:
 * ```ts
 * const session = SessionBuilder.create(durableState)
 *   .withLogger(logger)
 *   .withAI(env.AI)
 *   .withToolProvider(myToolProvider)
 *   .withPromptProvider(myPromptProvider)
 *   .build();
 * ```
 */
export class SessionBuilder {
  private durableState: DurableObjectState;
  private logger: Logger | null = null;
  private ai: Ai | undefined;
  private toolProvider: ToolProvider | null = null;
  private promptProvider: PromptProvider | null = null;
  private env: Record<string, unknown> = {};

  private constructor(durableState: DurableObjectState) {
    this.durableState = durableState;
  }

  static create(durableState: DurableObjectState): SessionBuilder {
    return new SessionBuilder(durableState);
  }

  withLogger(logger: Logger): SessionBuilder {
    this.logger = logger;
    return this;
  }

  withAI(ai: Ai | undefined): SessionBuilder {
    this.ai = ai;
    return this;
  }

  withToolProvider(provider: ToolProvider): SessionBuilder {
    this.toolProvider = provider;
    return this;
  }

  withPromptProvider(provider: PromptProvider): SessionBuilder {
    this.promptProvider = provider;
    return this;
  }

  withEnv(env: Record<string, unknown>): SessionBuilder {
    this.env = env;
    return this;
  }

  build(): ConversationSessionV2 {
    if (!this.logger) {
      throw new Error("Logger is required");
    }
    if (!this.toolProvider) {
      throw new Error("ToolProvider is required");
    }
    if (!this.promptProvider) {
      throw new Error("PromptProvider is required");
    }

    return new ConversationSessionV2(this.durableState, {
      durableState: this.durableState,
      ai: this.ai,
      logger: this.logger,
      toolProvider: this.toolProvider,
      promptProvider: this.promptProvider,
      env: this.env,
    });
  }
}

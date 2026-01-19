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
import { detectActionIntent } from "../intent";
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
  /** The user's message for this turn (used for contextual acknowledgements) */
  userMessage?: string;
  /** Whether the user is verified at the start of this turn */
  isVerified?: boolean;
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

    // Detect and store pending intent if customer is not verified
    // This captures intents like "reschedule" or "cancel" expressed before verification
    const currentState = this.state.get();
    const conversation = currentState.domainState["conversation"] as
      | { verification?: { verified?: boolean } }
      | undefined;
    const isVerified = Boolean(conversation?.verification?.verified);

    if (!isVerified) {
      const detectedIntent = detectActionIntent(input.text);
      if (detectedIntent) {
        this.logger.info(
          {
            intent: detectedIntent.kind,
            text: detectedIntent.text.slice(0, 50),
          },
          "session.pending_intent_detected",
        );
        await this.state.updateDomain({ pendingIntent: detectedIntent });
      }
    }

    // Create new stream ID for this turn
    const streamId = ++this.activeStreamId;
    this.canceledStreamIds.delete(streamId);

    // Create turn with context for acknowledgement generation
    const turn = this.createTurn();
    turn.userMessage = input.text;
    turn.isVerified = isVerified;
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
   * Run the agent loop with tools using direct AI.run calls.
   * This bypasses runWithTools for better control over the tool format.
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

    // Build messages - mutable for tool call loop
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

    // Build tool executors map for quick lookup
    const toolExecutors = new Map<
      string,
      {
        execute: (args: Record<string, unknown>) => Promise<string>;
        definition: (typeof tools)[0]["definition"];
      }
    >();
    for (const tool of tools) {
      toolExecutors.set(tool.definition.name, {
        definition: tool.definition,
        execute: async (args: Record<string, unknown>): Promise<string> => {
          // Queue acknowledgement prompt for aggregation
          if (tool.definition.acknowledgement && turn.isVerified) {
            const ack = tool.definition.acknowledgement;
            const ackText = typeof ack === "function" ? ack(sessionState) : ack;
            if (ackText) {
              turn.acknowledgementPrompts.push(ackText);
            }
          }

          // Emit aggregated acknowledgement once per turn
          if (
            turn.isVerified &&
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

          const startTime = Date.now();
          try {
            const result = await tool.execute(args, toolContext);
            const durationMs = Date.now() - startTime;

            this.events.emitToolCall(tool.definition.name, {
              turnId: turn.turnId,
              args,
              result,
              durationMs,
              success: true,
            });

            return JSON.stringify(result);
          } catch (error) {
            const durationMs = Date.now() - startTime;

            this.events.emitToolCall(tool.definition.name, {
              turnId: turn.turnId,
              args,
              result: {
                error: error instanceof Error ? error.message : "unknown",
              },
              durationMs,
              success: false,
            });

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
      });
    }

    // Build tools in the format that works with AI.run (proven via debug endpoint)
    const toolsForAI = tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.definition.name,
        description: tool.definition.description,
        parameters: tool.definition.parameters,
      },
    }));

    // Log available tools for debugging
    this.logger.info(
      {
        turnId: turn.turnId,
        toolCount: tools.length,
        toolNames: tools.map((t) => t.definition.name),
        model: this.config.model,
        sampleToolSchema: toolsForAI[0] ?? null,
      },
      "session.tools_available",
    );

    // Tool call loop - max iterations to prevent infinite loops
    let iterations = 0;
    const maxIterations = this.config.maxToolRuns;

    while (iterations < maxIterations) {
      iterations++;

      // Check for barge-in cancellation
      if (this.isStreamCanceled(streamId)) {
        this.logger.info(
          { turnId: turn.turnId, streamId, iteration: iterations },
          "session.agent_loop_canceled",
        );
        return "Request was interrupted.";
      }

      // Call AI with tools
      this.logger.info(
        {
          turnId: turn.turnId,
          iteration: iterations,
          messageCount: messages.length,
        },
        "session.ai_run_start",
      );

      // Cast model to any since config.model is a string but AI.run expects keyof AiModels
      const aiResponse = (await this.ai.run(
        this.config.model as Parameters<typeof this.ai.run>[0],
        {
          messages,
          tools: toolsForAI.length > 0 ? toolsForAI : undefined,
        },
      )) as {
        response?: string;
        tool_calls?: Array<{
          name: string;
          arguments: Record<string, unknown> | string;
        }>;
      };

      this.logger.info(
        {
          turnId: turn.turnId,
          iteration: iterations,
          hasResponse: Boolean(aiResponse.response),
          hasToolCalls: Boolean(aiResponse.tool_calls?.length),
          toolCallCount: aiResponse.tool_calls?.length ?? 0,
        },
        "session.ai_run_complete",
      );

      // If no tool calls, we have the final response
      if (!aiResponse.tool_calls || aiResponse.tool_calls.length === 0) {
        const responseText = aiResponse.response?.trim() ?? "";

        // Stream the final response (emit tokens)
        if (responseText && !this.isStreamCanceled(streamId)) {
          // Emit the response as a single chunk for now
          // TODO: Could implement word-by-word streaming for better UX
          this.events.emitToken(responseText, {
            turnId: turn.turnId,
            messageId: turn.messageId,
          });
        }

        return responseText || "I'm not sure how to respond to that.";
      }

      // Execute tool calls
      const toolResults: Array<{
        role: "tool";
        name: string;
        content: string;
      }> = [];

      for (const toolCall of aiResponse.tool_calls) {
        const executor = toolExecutors.get(toolCall.name);

        if (!executor) {
          this.logger.warn(
            { toolName: toolCall.name, turnId: turn.turnId },
            "session.unknown_tool_call",
          );
          toolResults.push({
            role: "tool",
            name: toolCall.name,
            content: JSON.stringify({
              error: `Unknown tool: ${toolCall.name}`,
            }),
          });
          continue;
        }

        // Parse arguments if they're a string
        let args: Record<string, unknown>;
        if (typeof toolCall.arguments === "string") {
          try {
            args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
          } catch {
            args = {};
          }
        } else {
          args = toolCall.arguments ?? {};
        }

        const result = await executor.execute(args);
        toolResults.push({
          role: "tool",
          name: toolCall.name,
          content: result,
        });
      }

      // Add assistant message with tool calls and tool results to messages
      // The assistant "called" these tools
      messages.push({
        role: "assistant",
        content: aiResponse.response ?? "",
      });

      // Add tool results
      for (const toolResult of toolResults) {
        messages.push(toolResult as unknown as RoleScopedChatInput);
      }
    }

    // Max iterations reached
    this.logger.warn(
      { turnId: turn.turnId, iterations },
      "session.max_tool_iterations_reached",
    );
    return "I apologize, but I'm having trouble completing this request. Please try again.";
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
    // Track raw output separately to detect function call JSON across chunks
    let rawBuffer = "";
    // Track if we've detected we're in the middle of filtering a function call
    let filteringFunctionCall = false;

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
              const responseText = parsed.response;
              rawBuffer += responseText;

              // Filter out malformed function call text that the model sometimes outputs
              // instead of using the proper tool call mechanism
              if (
                filteringFunctionCall ||
                this.looksLikeFunctionCallJson(responseText, rawBuffer)
              ) {
                filteringFunctionCall = true;
                this.logger.debug(
                  { text: responseText.slice(0, 100) },
                  "session.streaming_filtered_function_call_text",
                );

                // Check if the function call JSON is complete (balanced braces)
                const openBraces = (rawBuffer.match(/{/g) || []).length;
                const closeBraces = (rawBuffer.match(/}/g) || []).length;
                if (openBraces > 0 && openBraces === closeBraces) {
                  // Function call JSON is complete, reset filtering
                  filteringFunctionCall = false;
                  rawBuffer = "";
                }
                continue;
              }

              fullResponse += responseText;

              // Emit token if not canceled
              if (!this.isStreamCanceled(streamId)) {
                this.events.emitToken(responseText, {
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

      // If everything was filtered (model only output function call JSON),
      // provide a fallback response
      const trimmedResponse = fullResponse.trim();
      if (!trimmedResponse) {
        this.logger.warn(
          { turnId: turn.turnId },
          "session.streaming_empty_after_filter",
        );
        return "Is there anything else I can help you with?";
      }

      return trimmedResponse;
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

    // Build a contextual prompt for acknowledgement generation
    // Include the user's actual request so the acknowledgement is relevant
    const systemPromptLines = [
      "You are a friendly customer service agent. Generate a brief, natural acknowledgement that responds to what the customer just asked.",
      "This will be read aloud via text-to-speech, so write for natural speech.",
      "",
      "## Rules",
      "- Write exactly ONE short sentence (under 100 characters)",
      "- Reference what the customer actually asked for (reschedule, cancel, billing, etc.)",
      "- Sound human and conversational, like you're actually helping them",
      "- Do NOT ask any questions",
      "- Do NOT use generic phrases like 'Let me check that policy' or 'One moment'",
      "- Do NOT use filler words like 'certainly', 'absolutely', or 'of course'",
      "- Use natural speech formatting (e.g., 'from 1 to 3pm' not '1-3pm')",
      "",
      "## Good examples (contextual to request):",
      '- Customer wants to reschedule: "Sure, let me pull up your current appointments."',
      '- Customer asks about billing: "Got it, checking your account balance now."',
      '- Customer wants to cancel: "Understood, pulling up your appointments to cancel."',
      "",
      "## Bad examples (too generic):",
      '- "Let me check that for you." (doesn\'t reference what they asked)',
      '- "One moment please." (sounds robotic)',
      '- "Let me check that policy." (irrelevant to most requests)',
    ];
    const systemPrompt = systemPromptLines.join("\n");

    // Include the user's message for context
    const customerRequest = turn.userMessage
      ? `Customer said: "${turn.userMessage.slice(0, 200)}"\n\n`
      : "";

    const userPrompt =
      prompts.length === 1
        ? `${customerRequest}Write an acknowledgement for this action: ${prompts[0]}`
        : `${customerRequest}Write a single acknowledgement that covers these actions:\n${prompts.map((p) => `- ${p}`).join("\n")}`;

    try {
      // Use direct AI.run for simple acknowledgement generation (no tools needed)
      const response = (await this.ai.run(
        this.config.model as Parameters<typeof this.ai.run>[0],
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        },
      )) as { response?: string };

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

  /**
   * Detect if text looks like the start of a malformed function call JSON.
   * The model sometimes outputs function calls as text instead of using
   * the proper tool call mechanism. We need to filter these out.
   *
   * Patterns detected:
   * - `{"type": "function", "name": ...`
   * - `{"name": "tool.name", "arguments": ...`
   */
  private looksLikeFunctionCallJson(
    _newText: string,
    rawBuffer: string,
  ): boolean {
    // Check the accumulated buffer for function call patterns
    const combined = rawBuffer.trimStart();

    // Pattern 1: Direct function call JSON object with "type": "function"
    if (combined.startsWith('{"type"')) {
      if (combined.includes('"function"') || combined.includes('"name"')) {
        return true;
      }
    }

    // Pattern 2: Function call patterns via regex
    const functionCallPatterns = [
      /^\s*\{\s*"type"\s*:\s*"function"/,
      /^\s*\{\s*"name"\s*:\s*"[a-zA-Z_][a-zA-Z0-9_.]*"\s*,\s*"arg/,
      /^\s*\{\s*"type"\s*:\s*"function"\s*,\s*"name"/,
    ];

    for (const pattern of functionCallPatterns) {
      if (pattern.test(combined)) {
        return true;
      }
    }

    return false;
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

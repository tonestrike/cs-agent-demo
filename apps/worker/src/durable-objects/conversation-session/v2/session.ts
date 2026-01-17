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
import type { Ai, DurableObjectState, RoleScopedChatInput } from "@cloudflare/workers-types";
import { createConnectionManager, type ConnectionManager } from "./connection";
import { createEventEmitter, type EventEmitter } from "./events";
import { createStateManager, type StateManager } from "./state";
import {
  defaultSessionConfig,
  type ClientMessage,
  type Logger,
  type MessageInput,
  type MessageResult,
  type PromptProvider,
  type SessionConfig,
  type SessionDeps,
  type ToolContext,
  type ToolProvider,
} from "./types";

/** Message history entry */
type HistoryEntry = { role: "user" | "assistant"; content: string };

/** Turn tracking */
type TurnState = {
  turnId: number;
  messageId: string;
  startedAt: number;
  acknowledged: boolean;
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

  // Turn tracking
  private turnId = 0;
  private activeTurn: TurnState | null = null;
  private messageHistory: HistoryEntry[] = [];

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
      return this.connections.handleUpgrade(request);
    }

    // HTTP routes
    switch (url.pathname) {
      case "/health":
        return this.handleHealth();
      case "/state":
        return this.handleGetState();
      case "/message":
        if (request.method === "POST") {
          return this.handleHttpMessage(request);
        }
        break;
      case "/reset":
        if (request.method === "POST") {
          return this.handleReset();
        }
        break;
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
      const body = await request.json() as { text: string; phoneNumber?: string; callSessionId?: string };
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
   * Handle incoming client message (from WebSocket).
   */
  private async handleMessage(message: ClientMessage): Promise<void> {
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
    // Create turn
    const turn = this.createTurn();
    this.activeTurn = turn;

    this.logger.info(
      { turnId: turn.turnId, text: input.text.slice(0, 50) },
      "session.message_received",
    );

    // Update session metadata
    await this.state.updateMeta({
      phoneNumber: input.phoneNumber,
      callSessionId: input.callSessionId,
    });

    // Add to history
    this.messageHistory.push({ role: "user", content: input.text });
    this.trimHistory();

    // Start fallback timer
    this.startFallbackTimer(turn);

    try {
      // Process with model
      const response = await this.runAgentLoop(input, turn);

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
        { turnId: turn.turnId, error: error instanceof Error ? error.message : "unknown" },
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
    }
  }

  /**
   * Run the agent loop with tools.
   */
  private async runAgentLoop(input: MessageInput, turn: TurnState): Promise<string> {
    if (!this.ai) {
      this.logger.warn({}, "session.no_ai_binding");
      return "AI is not available. Please try again later.";
    }

    const sessionState = this.state.get();

    // Build system prompt via provider
    const systemPrompt = this.promptProvider.buildSystemPrompt(sessionState);

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
        // Emit acknowledgement on first tool call
        if (!turn.acknowledged) {
          turn.acknowledged = true;
          this.events.emitStatus("Working on that...", { turnId: turn.turnId });
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
            { toolName: tool.definition.name, error: error instanceof Error ? error.message : "unknown" },
            "session.tool_error",
          );
          return JSON.stringify({ error: "Tool execution failed" });
        }
      },
    }));

    // Run with tools
    const response = await runWithTools(
      this.ai,
      this.config.model as Parameters<typeof runWithTools>[1],
      { messages, tools: toolsForModel },
      {
        maxRecursiveToolRuns: this.config.maxToolRuns,
        streamFinalResponse: false,
        verbose: this.config.verbose,
      },
    );

    // Extract response text
    return this.extractResponseText(response);
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
   * Trim message history to prevent unbounded growth.
   */
  private trimHistory(maxMessages = 20): void {
    if (this.messageHistory.length > maxMessages) {
      this.messageHistory = this.messageHistory.slice(-maxMessages);
    }
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

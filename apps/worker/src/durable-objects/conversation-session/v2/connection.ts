/**
 * WebSocket connection handling for ConversationSession v2
 *
 * Manages WebSocket lifecycle, message parsing, and connection state.
 */

import type { EventEmitter } from "./events";
import type { ClientMessage, Logger } from "./types";

/**
 * Message handler callback type.
 */
export type MessageHandler = (message: ClientMessage) => Promise<void>;

/**
 * Connection manager for WebSocket connections.
 *
 * Provides:
 * - WebSocket upgrade handling
 * - Message parsing and routing
 * - Connection lifecycle management
 * - Barge-in handling
 */
/**
 * Connection handler callback type (called when a new WebSocket connects).
 */
export type ConnectHandler = () => Promise<void>;

export class ConnectionManager {
  private logger: Logger;
  private events: EventEmitter;
  private messageHandler: MessageHandler | null = null;
  private connectHandler: ConnectHandler | null = null;
  private activeConnections = new Map<WebSocket, { id: string }>();
  private isSpeaking = false;
  private lastBargeInAt = 0;

  constructor(logger: Logger, events: EventEmitter) {
    this.logger = logger;
    this.events = events;
  }

  /**
   * Set the message handler for incoming messages.
   */
  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Set the connect handler (called when a WebSocket connects).
   */
  setConnectHandler(handler: ConnectHandler): void {
    this.connectHandler = handler;
  }

  /**
   * Handle a WebSocket upgrade request.
   * Returns a Response with the WebSocket pair.
   */
  handleUpgrade(request: Request): Response {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    const connectionId = crypto.randomUUID();

    if (!server) {
      return new Response("WebSocket unavailable", { status: 500 });
    }

    // Accept the connection BEFORE setting up handlers so WebSocket is OPEN
    // when connect handler (greeting) tries to broadcast
    server.accept();
    this.setupConnection(server, connectionId);

    this.logger.info({ connectionId }, "connection.upgraded");

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Set up event handlers for a WebSocket connection.
   */
  private setupConnection(ws: WebSocket, connectionId: string): void {
    this.activeConnections.set(ws, { id: connectionId });
    this.events.addConnection(ws);

    ws.addEventListener("message", async (event) => {
      await this.handleMessage(ws, event.data);
    });

    ws.addEventListener("close", () => {
      this.handleClose(ws, connectionId);
    });

    ws.addEventListener("error", (event) => {
      this.logger.warn(
        { connectionId, error: String(event) },
        "connection.error",
      );
      this.handleClose(ws, connectionId);
    });

    // Call connect handler (e.g., to send greeting)
    if (this.connectHandler) {
      this.connectHandler().catch((error) => {
        this.logger.error(
          {
            connectionId,
            error: error instanceof Error ? error.message : "unknown",
          },
          "connection.connect_handler_error",
        );
      });
    }
  }

  /**
   * Handle an incoming WebSocket message.
   */
  private async handleMessage(ws: WebSocket, data: unknown): Promise<void> {
    if (typeof data !== "string") {
      this.logger.warn({ dataType: typeof data }, "connection.invalid_message");
      return;
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(data) as ClientMessage;
    } catch {
      this.logger.warn({ data }, "connection.parse_error");
      return;
    }

    // Handle barge-in immediately
    if (message.type === "barge_in") {
      await this.handleBargeIn();
      return;
    }

    // Handle resync
    if (message.type === "resync") {
      this.handleResync(ws, message.lastEventId);
      return;
    }

    // Route to message handler
    if (this.messageHandler) {
      try {
        await this.messageHandler(message);
      } catch (error) {
        this.logger.error(
          { error: error instanceof Error ? error.message : "unknown" },
          "connection.handler_error",
        );
        this.events.emitError("Failed to process message");
      }
    }
  }

  /**
   * Handle barge-in (user interrupted).
   */
  private async handleBargeIn(): Promise<void> {
    const now = Date.now();
    const debounceMs = 500;

    if (now - this.lastBargeInAt < debounceMs) {
      return; // Debounce rapid barge-ins
    }

    this.lastBargeInAt = now;
    this.isSpeaking = false;

    this.logger.info({}, "connection.barge_in");
    this.events.emitSpeaking(false);
  }

  /**
   * Handle resync request.
   */
  private handleResync(ws: WebSocket, lastEventId?: number): void {
    const events = lastEventId
      ? this.events.getEventsSince(lastEventId)
      : this.events.getAllEvents();

    this.logger.info(
      { lastEventId, eventCount: events.length },
      "connection.resync",
    );

    // Send resync event with buffered events
    const resyncEvent = {
      type: "resync" as const,
      id: this.events.getCurrentEventId(),
      seq: this.events.getCurrentEventId(),
      data: { events },
      at: new Date().toISOString(),
    };

    try {
      ws.send(JSON.stringify(resyncEvent));
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : "unknown" },
        "connection.resync_send_failed",
      );
    }
  }

  /**
   * Handle connection close.
   */
  private handleClose(ws: WebSocket, connectionId: string): void {
    this.activeConnections.delete(ws);
    this.events.removeConnection(ws);
    this.logger.info(
      { connectionId, remaining: this.activeConnections.size },
      "connection.closed",
    );
  }

  /**
   * Get number of active connections.
   */
  getConnectionCount(): number {
    return this.activeConnections.size;
  }

  /**
   * Check if currently speaking.
   */
  getSpeakingState(): boolean {
    return this.isSpeaking;
  }

  /**
   * Set speaking state.
   */
  setSpeaking(speaking: boolean): void {
    if (this.isSpeaking !== speaking) {
      this.isSpeaking = speaking;
      this.events.emitSpeaking(speaking);
    }
  }

  /**
   * Close all connections.
   */
  closeAll(code = 1000, reason = "session closed"): void {
    for (const [ws, { id }] of this.activeConnections) {
      try {
        ws.close(code, reason);
        this.logger.debug({ connectionId: id }, "connection.force_closed");
      } catch {
        // Ignore close errors
      }
    }
    this.activeConnections.clear();
  }
}

/**
 * Create a connection manager.
 *
 * Usage:
 * ```ts
 * const connections = createConnectionManager(logger, events);
 * connections.setMessageHandler(async (msg) => { ... });
 * return connections.handleUpgrade(request);
 * ```
 */
export function createConnectionManager(
  logger: Logger,
  events: EventEmitter,
): ConnectionManager {
  return new ConnectionManager(logger, events);
}

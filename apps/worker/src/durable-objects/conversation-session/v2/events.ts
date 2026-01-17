/**
 * Event emission for ConversationSession v2
 *
 * Manages event creation, buffering, and broadcasting to clients.
 * Events are generic - no domain-specific event types.
 */

import type { EventType, Logger, SessionEvent } from "./types";

/**
 * Event emitter for broadcasting to connected clients.
 *
 * Provides:
 * - Event creation with auto-incrementing IDs
 * - Event buffering for resync
 * - Broadcasting to WebSocket connections
 */
export class EventEmitter {
  private eventId = 0;
  private eventBuffer: SessionEvent[] = [];
  private maxBufferSize: number;
  private logger: Logger;
  private connections: Set<WebSocket> = new Set();

  constructor(logger: Logger, maxBufferSize = 100) {
    this.logger = logger;
    this.maxBufferSize = maxBufferSize;
  }

  /**
   * Register a WebSocket connection for event broadcasting.
   */
  addConnection(ws: WebSocket): void {
    this.connections.add(ws);
    this.logger.debug(
      { connectionCount: this.connections.size },
      "events.connection_added",
    );
  }

  /**
   * Remove a WebSocket connection.
   */
  removeConnection(ws: WebSocket): void {
    this.connections.delete(ws);
    this.logger.debug(
      { connectionCount: this.connections.size },
      "events.connection_removed",
    );
  }

  /**
   * Get current connection count.
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Emit an event to all connected clients.
   */
  emit(
    type: EventType,
    options: {
      text?: string;
      data?: unknown;
      turnId?: number | null;
      messageId?: string | null;
      role?: "assistant" | "system";
      correlationId?: string;
    } = {},
  ): SessionEvent {
    const event: SessionEvent = {
      id: ++this.eventId,
      seq: this.eventId,
      type,
      text: options.text,
      data: options.data,
      turnId: options.turnId,
      messageId: options.messageId,
      role: options.role ?? "assistant",
      correlationId: options.correlationId,
      at: new Date().toISOString(),
    };

    // Buffer the event
    this.bufferEvent(event);

    // Broadcast to all connections
    this.broadcast(event);

    return event;
  }

  /**
   * Emit a streaming token.
   */
  emitToken(
    text: string,
    options: {
      turnId?: number;
      messageId?: string;
      correlationId?: string;
    } = {},
  ): SessionEvent {
    return this.emit("token", {
      text,
      turnId: options.turnId,
      messageId: options.messageId,
      correlationId: options.correlationId,
    });
  }

  /**
   * Emit a final response.
   */
  emitFinal(
    text: string,
    options: {
      turnId?: number;
      messageId?: string;
      correlationId?: string;
      data?: unknown;
    } = {},
  ): SessionEvent {
    return this.emit("final", {
      text,
      turnId: options.turnId,
      messageId: options.messageId,
      correlationId: options.correlationId,
      data: options.data,
    });
  }

  /**
   * Emit a status message.
   */
  emitStatus(
    text: string,
    options: {
      turnId?: number;
      correlationId?: string;
    } = {},
  ): SessionEvent {
    return this.emit("status", {
      text,
      role: "system",
      turnId: options.turnId,
      correlationId: options.correlationId,
    });
  }

  /**
   * Emit an error.
   */
  emitError(
    message: string,
    options: {
      turnId?: number;
      correlationId?: string;
      data?: unknown;
    } = {},
  ): SessionEvent {
    return this.emit("error", {
      text: message,
      role: "system",
      turnId: options.turnId,
      correlationId: options.correlationId,
      data: options.data,
    });
  }

  /**
   * Emit speaking state change.
   */
  emitSpeaking(
    isSpeaking: boolean,
    options: {
      turnId?: number;
      correlationId?: string;
    } = {},
  ): SessionEvent {
    return this.emit("speaking", {
      data: { speaking: isSpeaking },
      turnId: options.turnId,
      correlationId: options.correlationId,
    });
  }

  /**
   * Get events since a given ID for resync.
   */
  getEventsSince(lastEventId: number): SessionEvent[] {
    return this.eventBuffer.filter((e) => e.id > lastEventId);
  }

  /**
   * Get all buffered events.
   */
  getAllEvents(): SessionEvent[] {
    return [...this.eventBuffer];
  }

  /**
   * Get current event ID.
   */
  getCurrentEventId(): number {
    return this.eventId;
  }

  /**
   * Buffer an event for resync.
   */
  private bufferEvent(event: SessionEvent): void {
    this.eventBuffer.push(event);

    // Trim buffer if too large
    while (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer.shift();
    }
  }

  /**
   * Broadcast an event to all connected clients.
   */
  private broadcast(event: SessionEvent): void {
    const message = JSON.stringify(event);
    const deadConnections: WebSocket[] = [];

    for (const ws of this.connections) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        } else {
          deadConnections.push(ws);
        }
      } catch (error) {
        this.logger.warn(
          { error: error instanceof Error ? error.message : "unknown" },
          "events.broadcast_failed",
        );
        deadConnections.push(ws);
      }
    }

    // Clean up dead connections
    for (const ws of deadConnections) {
      this.connections.delete(ws);
    }
  }

  /**
   * Clear event buffer.
   */
  clearBuffer(): void {
    this.eventBuffer = [];
  }

  /**
   * Close all connections.
   */
  closeAll(code = 1000, reason = "session closed"): void {
    for (const ws of this.connections) {
      try {
        ws.close(code, reason);
      } catch {
        // Ignore close errors
      }
    }
    this.connections.clear();
  }
}

/**
 * Create an event emitter.
 *
 * Usage:
 * ```ts
 * const events = createEventEmitter(logger);
 * events.addConnection(ws);
 * events.emitToken("Hello");
 * events.emitFinal("Hello, how can I help?");
 * ```
 */
export function createEventEmitter(
  logger: Logger,
  maxBufferSize = 100,
): EventEmitter {
  return new EventEmitter(logger, maxBufferSize);
}

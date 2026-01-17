/**
 * Event emitter factory for conversation session events
 */

import { initialConversationState } from "../../../conversation/state-machine";
import type { ConversationState } from "../../../conversation/state-machine";
import type { Logger } from "../../../logger";
import type { ConversationEvent, ConversationEventType } from "../types";

const MAX_EVENT_BUFFER = 200;

export type EventEmitterState = {
  eventBuffer: ConversationEvent[];
  lastEventId: number;
  speaking: boolean;
  connections: Set<WebSocket>;
  activeTurnId: number | null;
  activeMessageId: string | null;
  sessionConversation: ConversationState | undefined;
};

export type EventEmitterDeps = {
  logger: Logger;
  storage: DurableObjectStorage;
  getState: () => EventEmitterState;
  updateEventId: (id: number) => void;
  recordTurnToken: () => void;
  recordTurnStatus: () => void;
};

/**
 * Determine the default role for an event type
 */
function getDefaultRole(type: ConversationEventType): "assistant" | "system" {
  return type === "status" ||
    type === "error" ||
    type === "resync" ||
    type === "speaking"
    ? "system"
    : "assistant";
}

/**
 * Create an event emitter instance with injected dependencies
 */
export function createEventEmitter(deps: EventEmitterDeps) {
  const {
    logger,
    storage,
    getState,
    updateEventId,
    recordTurnToken,
    recordTurnStatus,
  } = deps;

  /**
   * Send a payload to a single websocket
   */
  function sendTo(
    socket: WebSocket,
    event: Omit<ConversationEvent, "id" | "seq" | "at"> | ConversationEvent,
  ): void {
    const state = getState();
    const payload =
      "id" in event && "at" in event
        ? event
        : {
            ...event,
            id: state.lastEventId,
            seq: state.lastEventId,
            turnId: event.turnId ?? state.activeTurnId,
            messageId: event.messageId ?? state.activeMessageId,
            role: event.role ?? getDefaultRole(event.type),
            at: new Date().toISOString(),
          };
    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "conversation.session.send_failed",
      );
      state.connections.delete(socket);
    }
  }

  /**
   * Emit an event to all connected clients
   */
  function emitEvent(
    event: Omit<ConversationEvent, "id" | "seq" | "at">,
  ): void {
    const state = getState();

    if (event.type === "token") {
      recordTurnToken();
    }
    if (event.type === "status") {
      recordTurnStatus();
    }

    const newId = state.lastEventId + 1;
    updateEventId(newId);

    const enriched: ConversationEvent = {
      ...event,
      id: newId,
      seq: newId,
      turnId: event.turnId ?? state.activeTurnId,
      messageId: event.messageId ?? state.activeMessageId,
      role: event.role ?? getDefaultRole(event.type),
      at: new Date().toISOString(),
    };

    state.eventBuffer.push(enriched);
    if (state.eventBuffer.length > MAX_EVENT_BUFFER) {
      state.eventBuffer.shift();
    }

    void storage.put({
      events: state.eventBuffer,
      lastEventId: newId,
    });

    for (const socket of state.connections) {
      sendTo(socket, enriched);
    }
  }

  /**
   * Collect events after a given event ID
   */
  function collectEventsAfter(lastEventId?: number): ConversationEvent[] {
    const state = getState();
    if (!lastEventId) {
      return [...state.eventBuffer];
    }
    return state.eventBuffer.filter((event) => event.id > lastEventId);
  }

  /**
   * Replay events to a socket for resync
   */
  function replayEvents(
    lastEventId: number | undefined,
    socket: WebSocket,
  ): void {
    const state = getState();
    const events = collectEventsAfter(lastEventId);
    for (const event of events) {
      sendTo(socket, event);
    }
    sendTo(socket, {
      type: "resync",
      data: {
        fromId: lastEventId ?? null,
        toId: state.lastEventId,
        speaking: state.speaking,
        state: state.sessionConversation ?? initialConversationState(),
      },
    });
  }

  return {
    emitEvent,
    sendTo,
    collectEventsAfter,
    replayEvents,
  };
}

export type EventEmitter = ReturnType<typeof createEventEmitter>;

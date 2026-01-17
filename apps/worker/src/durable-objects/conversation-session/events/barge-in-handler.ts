/**
 * Barge-in handling for conversation sessions
 */

import type { EventEmitter } from "./event-emitter";

export type BargeInHandlerDeps = {
  storage: DurableObjectStorage;
  getActiveStreamId: () => number;
  getSpeaking: () => boolean;
  setSpeaking: (value: boolean) => void;
  addCanceledStreamId: (id: number) => void;
  emitter: EventEmitter;
};

/**
 * Create a barge-in handler with injected dependencies
 */
export function createBargeInHandler(deps: BargeInHandlerDeps) {
  const {
    storage,
    getActiveStreamId,
    getSpeaking,
    setSpeaking,
    addCanceledStreamId,
    emitter,
  } = deps;

  /**
   * Handle a barge-in event (user interrupting)
   */
  async function handleBargeIn(): Promise<void> {
    const streamId = getActiveStreamId();
    addCanceledStreamId(streamId);
    await setSpeakingValue(false);
  }

  /**
   * Set the speaking state and emit an event
   */
  async function setSpeakingValue(value: boolean): Promise<void> {
    if (getSpeaking() === value) {
      return;
    }
    setSpeaking(value);
    await storage.put("speaking", value);
    emitter.emitEvent({
      type: "speaking",
      data: { value },
    });
  }

  return {
    handleBargeIn,
    setSpeaking: setSpeakingValue,
  };
}

export type BargeInHandler = ReturnType<typeof createBargeInHandler>;

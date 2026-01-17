/**
 * Barrel export for event handling
 */

export {
  createEventEmitter,
  type EventEmitter,
  type EventEmitterDeps,
  type EventEmitterState,
} from "./event-emitter";

export {
  createBargeInHandler,
  type BargeInHandler,
  type BargeInHandlerDeps,
} from "./barge-in-handler";

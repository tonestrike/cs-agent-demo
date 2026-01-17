/**
 * Barrel export for narration functions
 */

export { sanitizeNarratorOutput } from "./sanitizer";
export {
  createNarrator,
  type Narrator,
  type NarratorDeps,
  type NarratorInput,
  type NarratorCustomerContext,
  type NarratorModelAdapter,
} from "./narrator";

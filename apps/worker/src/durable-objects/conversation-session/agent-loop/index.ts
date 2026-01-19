/**
 * Unified Agent Loop
 *
 * Uses `@cloudflare/ai-utils` runWithTools to implement a model-first
 * architecture where the model sees all context and decides all actions.
 *
 * Key features:
 * - Tool gating based on verification and workflow state
 * - Automatic tool loop (model calls tools → results fed back → repeat)
 * - Single exit point with final response
 * - Streaming support for real-time responses
 *
 * @module agent-loop
 */

export {
  runAgentLoop,
  type AgentLoopConfig,
  type AgentLoopResult,
} from "./loop";
export {
  buildToolsForState,
  createToolFunction,
  type ToolFunctionContext,
} from "./tools";

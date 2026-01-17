/**
 * Tool flow module
 *
 * Handles tool execution with aggregate result narration.
 *
 * Key concepts:
 * - Tool handlers return raw results (not narrated text)
 * - Executor validates args with Zod schemas before calling handlers
 * - Multiple tools can execute in parallel
 * - Single narration step handles all results together
 *
 * Usage:
 * ```ts
 * const result = await executeAndNarrate(ctx, toolCalls, input);
 * ```
 */

export { executeAndNarrate, executeTools, narrateResults } from "./executor";
export type { ToolCall } from "./executor";
export {
  getToolHandler,
  hasToolHandler,
  toolHandlerRegistry,
} from "./registry";
export type {
  ToolArgs,
  ToolExecutionInput,
  ToolExecutionResult,
  ToolFlowContext,
  ToolFlowOutput,
  ToolHandler,
  ToolHandlerRegistry,
  ToolRawResult,
} from "./types";

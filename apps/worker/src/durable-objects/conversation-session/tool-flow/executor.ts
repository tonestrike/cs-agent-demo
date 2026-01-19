/**
 * Tool execution orchestrator
 *
 * Executes multiple tools and aggregates results for unified narration.
 *
 * Flow:
 * 1. Validate args against tool schemas
 * 2. Execute all tool handlers (parallelized)
 * 3. Collect raw results from each
 * 4. Merge state updates
 * 5. Return aggregated results for single narration step
 */

import {
  type AgentToolName,
  toolDefinitions,
  validateToolArgs,
} from "../../../models/tool-definitions";
import type { AgentMessageInput } from "../../../schemas/agent";
import { getToolHandler, hasToolHandler } from "./registry";
import type {
  ToolExecutionResult,
  ToolFlowContext,
  ToolFlowOutput,
  ToolRawResult,
} from "./types";

/** A single tool call request (unvalidated) */
export type ToolCall = {
  toolName: string;
  args: Record<string, unknown>;
};

/**
 * Check if a tool name is a known agent tool.
 */
function isAgentToolName(name: string): name is AgentToolName {
  return name in toolDefinitions;
}

/**
 * Execute multiple tools and aggregate results.
 *
 * Tools are executed in parallel when possible. Results are
 * collected and returned for unified narration.
 */
export async function executeTools(
  ctx: ToolFlowContext,
  toolCalls: ToolCall[],
  input: AgentMessageInput,
  acknowledgementText?: string,
): Promise<ToolExecutionResult> {
  const callSessionId = input.callSessionId ?? crypto.randomUUID();
  const results: ToolRawResult[] = [];
  const debug: Record<string, unknown> = {
    toolCallCount: toolCalls.length,
    toolNames: toolCalls.map((tc) => tc.toolName),
  };

  // Execute tools in parallel
  const executions = toolCalls.map(async (toolCall) => {
    const { toolName, args } = toolCall;

    // Check if it's a known tool
    if (!isAgentToolName(toolName)) {
      ctx.logger.warn(`Unknown tool: ${toolName}`);
      return {
        toolName,
        result: { error: "unknown_tool" },
        fallback: `I don't know how to handle ${toolName}.`,
        contextHint: "Tool not recognized.",
      } satisfies ToolRawResult;
    }

    // Check if we have a handler
    if (!hasToolHandler(toolName)) {
      ctx.logger.warn(`No handler for tool: ${toolName}`);
      return {
        toolName,
        result: { error: "no_handler" },
        fallback: `I can't process ${toolName} right now.`,
        contextHint: "Tool handler not implemented.",
      } satisfies ToolRawResult;
    }

    // Validate args against schema
    const validation = validateToolArgs(toolName, args);
    if (!validation.ok) {
      ctx.logger.warn(`Invalid args for tool: ${toolName}`);
      return {
        toolName,
        result: { error: "invalid_args" },
        fallback: validation.message,
        contextHint: "Ask for missing information.",
      } satisfies ToolRawResult;
    }

    const handler = getToolHandler(toolName);
    if (!handler) {
      // Shouldn't happen after hasToolHandler check, but TypeScript
      return {
        toolName,
        result: { error: "handler_missing" },
        fallback: "Something went wrong. Please try again.",
        contextHint: "Internal error.",
      } satisfies ToolRawResult;
    }

    try {
      return await handler(ctx, {
        toolName,
        args: validation.data,
        input,
      });
    } catch (error) {
      ctx.logger.error(`Tool execution error: ${toolName} - ${error}`);
      return {
        toolName,
        result: { error: "execution_failed" },
        fallback: "Something went wrong. Please try again.",
        contextHint: "Tool execution failed.",
      } satisfies ToolRawResult;
    }
  });

  const rawResults = await Promise.all(executions);
  results.push(...rawResults);

  // Merge all state updates
  const mergedStateUpdates: Record<string, unknown> = {};
  for (const result of results) {
    if (result.stateUpdates) {
      Object.assign(mergedStateUpdates, result.stateUpdates);
    }
  }

  // Apply merged state updates
  if (Object.keys(mergedStateUpdates).length > 0) {
    await ctx.updateState(mergedStateUpdates);
  }

  return {
    callSessionId,
    results,
    acknowledgementText,
    debug,
  };
}

/**
 * Narrate aggregated tool results into a single response.
 *
 * This produces the final user-facing response that considers
 * all tool results together.
 */
export async function narrateResults(
  ctx: ToolFlowContext,
  executionResult: ToolExecutionResult,
  input: AgentMessageInput,
): Promise<ToolFlowOutput> {
  const { callSessionId, results, acknowledgementText, debug } =
    executionResult;

  // If no results, return acknowledgement or fallback
  if (results.length === 0) {
    return {
      callSessionId,
      replyText: acknowledgementText || "I'm not sure what to do with that.",
      actions: [],
      debug,
    };
  }

  // Narrate all results together
  const narratedText = await ctx.narrateToolResults(
    results,
    input,
    acknowledgementText,
  );

  // Join with acknowledgement if present
  const activeAcknowledgement = acknowledgementText?.trim() || "";
  const replyText = ctx.joinNarration(activeAcknowledgement, narratedText);

  return {
    callSessionId,
    replyText,
    actions: [],
    debug,
  };
}

/**
 * Execute tools and narrate results in one step.
 *
 * Convenience function that combines executeTools and narrateResults.
 */
export async function executeAndNarrate(
  ctx: ToolFlowContext,
  toolCalls: ToolCall[],
  input: AgentMessageInput,
  acknowledgementText?: string,
): Promise<ToolFlowOutput> {
  const executionResult = await executeTools(
    ctx,
    toolCalls,
    input,
    acknowledgementText,
  );
  return narrateResults(ctx, executionResult, input);
}

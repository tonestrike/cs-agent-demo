/**
 * Tool builder for agent loop
 *
 * Creates the tools array for runWithTools with:
 * - Declarative gating based on verification/workflow state
 * - Tool execution functions that call existing handlers
 * - JSON schema conversion via zod-to-json-schema
 */

import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  type AgentToolName,
  type ToolGatingState,
  getAvailableTools,
  toolDefinitions,
} from "../../../models/tool-definitions";
import type { AgentMessageInput } from "../../../schemas/agent";
import { getToolHandler, hasToolHandler } from "../tool-flow/registry";
import type { ToolFlowContext, ToolRawResult } from "../tool-flow/types";

/** Context for tool function execution */
export type ToolFunctionContext = {
  /** Tool flow context for executing handlers */
  toolFlowCtx: ToolFlowContext;
  /** Current message input */
  input: AgentMessageInput;
  /** Logger */
  logger: ToolFlowContext["logger"];
};

/** Tool parameters schema expected by Workers AI */
export type ToolParameters = {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required: string[];
};

/** Tool definition for runWithTools */
export type AgentTool = {
  name: string;
  description: string;
  parameters: ToolParameters;
  function: (args: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Convert Zod schema to JSON Schema for Workers AI tools.
 * Uses zod-to-json-schema library for compatibility.
 */
function schemaToToolParameters(schema: z.ZodTypeAny): ToolParameters {
  // Cast to any to handle Zod version type differences
  const jsonSchema = zodToJsonSchema(schema);

  // Ensure we have the required structure for Workers AI
  const result: ToolParameters = {
    type: "object",
    properties: {},
    required: [],
  };

  if (typeof jsonSchema === "object" && jsonSchema !== null) {
    if (
      "properties" in jsonSchema &&
      typeof jsonSchema.properties === "object"
    ) {
      result.properties = jsonSchema.properties as ToolParameters["properties"];
    }
    if ("required" in jsonSchema && Array.isArray(jsonSchema.required)) {
      result.required = jsonSchema.required as string[];
    }
  }

  return result;
}

/**
 * Create a tool execution function for a given tool name.
 *
 * The function wraps the existing tool handler and returns
 * results in a format the model can understand.
 */
export function createToolFunction(
  toolName: AgentToolName,
  ctx: ToolFunctionContext,
): (args: Record<string, unknown>) => Promise<unknown> {
  return async (args: Record<string, unknown>) => {
    ctx.logger.info({ toolName, args }, "agent_loop.tool_call");

    // Check if we have a handler
    if (!hasToolHandler(toolName)) {
      ctx.logger.warn({ toolName }, "agent_loop.no_handler");
      return {
        error: "no_handler",
        message: `Tool ${toolName} is not implemented.`,
      };
    }

    const handler = getToolHandler(toolName);
    if (!handler) {
      return {
        error: "handler_missing",
        message: "Internal error: handler not found.",
      };
    }

    try {
      const result: ToolRawResult = await handler(ctx.toolFlowCtx, {
        toolName,
        args: args as Parameters<typeof handler>[1]["args"],
        input: ctx.input,
      });

      ctx.logger.info(
        { toolName, hasResult: !!result.result },
        "agent_loop.tool_result",
      );

      // Apply state updates if any
      if (result.stateUpdates) {
        await ctx.toolFlowCtx.updateState(result.stateUpdates);
      }

      // Return the raw result for the model to interpret
      return result.result;
    } catch (error) {
      ctx.logger.error(
        { toolName, error: error instanceof Error ? error.message : "unknown" },
        "agent_loop.tool_error",
      );
      return {
        error: "execution_failed",
        message: "Tool execution failed. Please try again.",
      };
    }
  };
}

/**
 * Build tools array for runWithTools based on current state.
 *
 * Tools are filtered based on:
 * - requiresVerification: Only shown when user is verified
 * - requiresActiveWorkflow: Only shown when a workflow is active
 */
export function buildToolsForState(
  state: ToolGatingState,
  ctx: ToolFunctionContext,
): AgentTool[] {
  const availableTools = getAvailableTools(state);
  const tools: AgentTool[] = [];

  for (const [name, definition] of Object.entries(availableTools)) {
    const toolName = name as AgentToolName;

    // Skip tools without handlers (they won't work anyway)
    if (!hasToolHandler(toolName)) {
      ctx.logger.debug({ toolName }, "agent_loop.skip_no_handler");
      continue;
    }

    tools.push({
      name: toolName,
      description: definition.description,
      parameters: schemaToToolParameters(definition.inputSchema),
      function: createToolFunction(toolName, ctx),
    });
  }

  ctx.logger.info(
    {
      totalTools: Object.keys(toolDefinitions).length,
      availableTools: tools.length,
      isVerified: state.isVerified,
      hasActiveWorkflow: state.hasActiveWorkflow,
      toolNames: tools.map((t) => t.name),
    },
    "agent_loop.tools_built",
  );

  return tools;
}

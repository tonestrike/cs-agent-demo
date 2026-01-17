/**
 * Tool Provider Implementation
 *
 * Wraps the existing tool definitions and handlers from the codebase,
 * adapting them to the v2 generic interface.
 *
 * This is where domain knowledge lives - the session itself stays generic.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import type { createDependencies } from "../../../../context";
import {
  type AgentToolName,
  type ToolGatingState,
  getAvailableTools,
} from "../../../../models/tool-definitions";
import { getToolHandler, hasToolHandler } from "../../tool-flow/registry";
import type { ToolFlowContext, ToolRawResult } from "../../tool-flow/types";
import type {
  SessionState,
  ToolContext,
  ToolDefinition,
  ToolExecutor,
  ToolProvider,
} from "../types";

/**
 * Configuration for the tool provider.
 */
export type ToolProviderConfig = {
  /** Dependencies from createDependencies() */
  deps: ReturnType<typeof createDependencies>;
  /** Stream ID for cancellation */
  streamId: number;
  /** Narration function for tool results */
  narrateResult?: (result: ToolRawResult) => Promise<string>;
};

/**
 * Convert Zod schema to v2 ToolDefinition parameters format.
 */
function schemaToParameters(schema: unknown): ToolDefinition["parameters"] {
  const jsonSchema = zodToJsonSchema(
    schema as Parameters<typeof zodToJsonSchema>[0],
  );

  const result: ToolDefinition["parameters"] = {
    type: "object",
    properties: {},
    required: [],
  };

  if (typeof jsonSchema === "object" && jsonSchema !== null) {
    if (
      "properties" in jsonSchema &&
      typeof jsonSchema.properties === "object"
    ) {
      result.properties =
        jsonSchema.properties as ToolDefinition["parameters"]["properties"];
    }
    if ("required" in jsonSchema && Array.isArray(jsonSchema.required)) {
      result.required = jsonSchema.required as string[];
    }
  }

  return result;
}

/**
 * Extract gating state from v2 session state.
 */
function extractGatingState(state: SessionState): ToolGatingState {
  const domainState = state.domainState;
  // Check verification in conversation state (where handleVerifyAccount stores it)
  // biome-ignore lint/complexity/useLiteralKeys: index signature access
  const conversation = domainState["conversation"] as
    | { verification?: { verified?: boolean } }
    | undefined;
  const isVerified = Boolean(conversation?.verification?.verified);

  return {
    isVerified,
    hasActiveWorkflow:
      // biome-ignore lint/complexity/useLiteralKeys: index signature access
      Boolean(domainState["rescheduleWorkflowId"]) ||
      // biome-ignore lint/complexity/useLiteralKeys: index signature access
      Boolean(domainState["cancelWorkflowId"]) ||
      // biome-ignore lint/complexity/useLiteralKeys: index signature access
      Boolean(domainState["activeSelection"]),
  };
}

/**
 * Build a ToolFlowContext adapter from v2's simpler ToolContext.
 * This bridges the v2 interface to the existing tool handlers.
 */
function buildToolFlowContext(
  ctx: ToolContext,
  config: ToolProviderConfig,
): ToolFlowContext {
  const ds = ctx.sessionState.domainState;

  return {
    logger: config.deps.logger,
    sessionState: {
      // Map v2 SessionState to v1 SessionState structure
      lastPhoneNumber: ctx.sessionState.phoneNumber,
      lastCallSessionId: ctx.sessionState.callSessionId,
      // biome-ignore lint/complexity/useLiteralKeys: index signature access
      conversation: ds["conversation"] as
        | ToolFlowContext["sessionState"]["conversation"]
        | undefined,
      // biome-ignore lint/complexity/useLiteralKeys: index signature access
      cancelWorkflowId: ds["cancelWorkflowId"] as string | undefined,
      // biome-ignore lint/complexity/useLiteralKeys: index signature access
      rescheduleWorkflowId: ds["rescheduleWorkflowId"] as string | undefined,
      // biome-ignore lint/complexity/useLiteralKeys: index signature access
      availableSlots: ds["availableSlots"] as
        | Array<{ id: string; date: string; timeWindow: string }>
        | undefined,
      // biome-ignore lint/complexity/useLiteralKeys: index signature access
      pendingIntent: ds["pendingIntent"] as
        | ToolFlowContext["sessionState"]["pendingIntent"]
        | undefined,
      // biome-ignore lint/complexity/useLiteralKeys: index signature access
      activeSelection: ds["activeSelection"] as
        | {
            kind: "appointment" | "slot" | "confirmation";
            options: Array<{ id: string; label: string }>;
            presentedAt: number;
            workflowType: "cancel" | "reschedule";
          }
        | undefined,
    },
    deps: config.deps,
    streamId: config.streamId,
    getConversationState: () => {
      // biome-ignore lint/complexity/useLiteralKeys: index signature access
      const conversation = ds["conversation"] as
        | ToolFlowContext["sessionState"]["conversation"]
        | undefined;
      return (
        conversation ?? {
          status: "CollectingVerification" as const,
          verification: { verified: false, customerId: null, zipAttempts: 0 },
          appointments: [],
          pendingCancellationId: null,
          pendingRescheduleId: null,
          pendingRescheduleSlotId: null,
          pendingScheduleSlotId: null,
          pendingScheduleAddressConfirmed: false,
        }
      );
    },
    updateState: async (updates) => {
      // Convert v1 updates to v2 domain state updates
      await ctx.updateState(updates as Record<string, unknown>);
    },
    narrateToolResults: async () => {
      // Not used in v2 - agent loop handles narration
      return "";
    },
    narrateToolResult: async () => {
      // Not used in v2 - agent loop handles narration
      return "";
    },
    narrateText: async () => {
      // Not used in v2 - agent loop handles narration
      return "";
    },
    joinNarration: (first, second) => {
      if (!first) return second;
      if (!second) return first;
      return `${first} ${second}`;
    },
    updateAppointmentSummary: async () => {
      // Could be implemented if needed
    },
  };
}

/**
 * Create a tool executor for a given tool name.
 */
function createExecutor(
  toolName: AgentToolName,
  config: ToolProviderConfig,
): ToolExecutor {
  return async (args, ctx) => {
    ctx.logger.info({ toolName, args }, "tool_provider.executing");

    // Check if handler exists
    if (!hasToolHandler(toolName)) {
      ctx.logger.warn({ toolName }, "tool_provider.no_handler");
      return {
        error: "not_implemented",
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

    // Build the ToolFlowContext adapter
    const toolFlowCtx = buildToolFlowContext(ctx, config);

    try {
      const result: ToolRawResult = await handler(toolFlowCtx, {
        toolName,
        args: args as Parameters<typeof handler>[1]["args"],
        input: {
          text: ctx.input.text,
          phoneNumber: ctx.input.phoneNumber ?? "",
          callSessionId: ctx.input.callSessionId,
        },
      });

      ctx.logger.info(
        { toolName, hasResult: !!result.result },
        "tool_provider.completed",
      );

      // Apply state updates if any
      if (result.stateUpdates) {
        await ctx.updateState(result.stateUpdates as Record<string, unknown>);
      }

      return result.result;
    } catch (error) {
      ctx.logger.error(
        { toolName, error: error instanceof Error ? error.message : "unknown" },
        "tool_provider.error",
      );
      return {
        error: "execution_failed",
        message: "Tool execution failed. Please try again.",
      };
    }
  };
}

/**
 * Create a ToolProvider that wraps the existing tool definitions and handlers.
 *
 * Usage:
 * ```ts
 * const toolProvider = createToolProvider({
 *   deps: createDependencies(env, ctx),
 *   streamId: 1,
 * });
 * ```
 */
export function createToolProvider(config: ToolProviderConfig): ToolProvider {
  return {
    getTools: (state: SessionState) => {
      const gatingState = extractGatingState(state);
      const availableTools = getAvailableTools(gatingState);
      const tools: Array<{
        definition: ToolDefinition;
        execute: ToolExecutor;
      }> = [];

      for (const [name, definition] of Object.entries(availableTools)) {
        const toolName = name as AgentToolName;

        // Skip tools without handlers
        if (!hasToolHandler(toolName)) {
          continue;
        }

        tools.push({
          definition: {
            name: toolName,
            description: definition.description,
            parameters: schemaToParameters(definition.inputSchema),
            acknowledgement: definition.acknowledgement,
          },
          execute: createExecutor(toolName, config),
        });
      }

      return tools;
    },
  };
}

/**
 * Create a minimal tool provider with no tools (for testing).
 */
export function createEmptyToolProvider(): ToolProvider {
  return {
    getTools: () => [],
  };
}

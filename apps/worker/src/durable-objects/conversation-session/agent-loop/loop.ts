/**
 * Agent Loop Implementation
 *
 * Uses `runWithTools` from @cloudflare/ai-utils to implement
 * a unified model-first conversation flow.
 *
 * The loop:
 * 1. Builds context with verification/workflow state
 * 2. Filters tools based on state
 * 3. Calls model with tools
 * 4. Model executes tools automatically (via runWithTools)
 * 5. Returns final response after all tools complete
 */

import { runWithTools } from "@cloudflare/ai-utils";
import type {
  Ai,
  AiModels,
  RoleScopedChatInput,
} from "@cloudflare/workers-types";
import type { AgentPromptConfig } from "@pestcall/core";
import type { Logger } from "../../../logger";
import type { ToolGatingState } from "../../../models/tool-definitions";
import type { AgentMessageInput } from "../../../schemas/agent";
import type { ToolFlowContext } from "../tool-flow/types";
import { type ToolFunctionContext, buildToolsForState } from "./tools";

/** Configuration for the agent loop */
export type AgentLoopConfig = {
  /** Workers AI binding */
  ai: Ai;
  /** Model to use (e.g., "@cf/meta/llama-3.3-70b-instruct-fp8-fast") */
  model: keyof AiModels;
  /** Prompt configuration */
  promptConfig: AgentPromptConfig;
  /** Logger instance */
  logger: Logger;
  /** Maximum recursive tool runs (default: 5) */
  maxToolRuns?: number;
  /** Enable streaming for final response */
  streamFinalResponse?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;
};

/** Result from the agent loop */
export type AgentLoopResult = {
  /** Final response text */
  response: string;
  /** Whether the response is a stream */
  isStream: boolean;
  /** Number of tool calls made */
  toolCallCount: number;
  /** Debug information */
  debug?: Record<string, unknown>;
};

/**
 * Build system instructions for the agent.
 */
function buildSystemInstructions(
  config: AgentPromptConfig,
  state: ToolGatingState,
  workflowContext?: string,
): string {
  const lines = [
    config.personaSummary,
    `Company: ${config.companyName}.`,
    `Tone: ${config.tone}.`,
    "",
    "## Current State",
    `- Customer verified: ${state.isVerified ? "yes" : "no"}`,
    `- Active workflow: ${state.hasActiveWorkflow ? "yes" : "no"}`,
    "",
  ];

  if (!state.isVerified) {
    lines.push(
      "## Verification Required",
      "The customer is NOT verified. You can only:",
      "- Ask for their 5-digit ZIP code to verify",
      "- Answer general service policy questions",
      "- Acknowledge their request and explain you need to verify first",
      "",
      'Example: "Happy to help you reschedule! First, can you confirm your ZIP code?"',
      "",
    );
  }

  if (state.hasActiveWorkflow && workflowContext) {
    lines.push(
      "## Active Workflow",
      workflowContext,
      "",
      "Use the workflow tools (selectAppointment, selectSlot, confirm) to help the customer complete this flow.",
      "",
    );
  }

  lines.push(
    "## Guidelines",
    "- Call tools when you need information or need to take action",
    "- Keep responses warm, concise, and conversational",
    "- Never mention tool names or internal systems to the customer",
    "- If you don't have access to a tool you need, explain why (e.g., need verification)",
    `- ${config.scopeMessage}`,
    "",
    "## Tool Usage",
    "- When you call a tool, you'll receive the result automatically",
    "- You can call multiple tools if needed",
    "- After getting tool results, formulate a natural response",
  );

  return lines.join("\n");
}

/**
 * Build messages array for the model.
 */
function buildMessages(
  systemInstructions: string,
  input: AgentMessageInput,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
): RoleScopedChatInput[] {
  const messages: RoleScopedChatInput[] = [
    { role: "system", content: systemInstructions },
  ];

  // Add conversation history
  for (const msg of conversationHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Add current user message
  messages.push({ role: "user", content: input.text });

  return messages;
}

/**
 * Run the unified agent loop.
 *
 * This function:
 * 1. Builds context based on current state
 * 2. Filters available tools based on verification/workflow
 * 3. Calls the model with runWithTools
 * 4. Returns final response after all tool chains complete
 */
export async function runAgentLoop(
  config: AgentLoopConfig,
  toolFlowCtx: ToolFlowContext,
  input: AgentMessageInput,
  state: ToolGatingState,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  workflowContext?: string,
): Promise<AgentLoopResult> {
  const { ai, model, promptConfig, logger, maxToolRuns = 5 } = config;

  logger.info(
    {
      model,
      isVerified: state.isVerified,
      hasActiveWorkflow: state.hasActiveWorkflow,
      historyLength: conversationHistory.length,
    },
    "agent_loop.start",
  );

  // Build tool function context
  const toolFunctionCtx: ToolFunctionContext = {
    toolFlowCtx,
    input,
    logger,
  };

  // Build tools filtered by state
  const tools = buildToolsForState(state, toolFunctionCtx);

  // Build system instructions
  const systemInstructions = buildSystemInstructions(
    promptConfig,
    state,
    workflowContext,
  );

  // Build messages
  const messages = buildMessages(
    systemInstructions,
    input,
    conversationHistory,
  );

  let toolCallCount = 0;

  try {
    // Use runWithTools for automatic tool loop
    const response = await runWithTools(
      ai,
      model,
      {
        messages,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          function: async (args: Record<string, unknown>): Promise<string> => {
            toolCallCount++;
            const result = await tool.function(args);
            return JSON.stringify(result);
          },
        })),
      },
      {
        maxRecursiveToolRuns: maxToolRuns,
        streamFinalResponse: config.streamFinalResponse ?? false,
        verbose: config.verbose ?? false,
      },
    );

    // Extract response text
    let responseText = "";
    if (typeof response === "string") {
      responseText = response;
    } else if (response && typeof response === "object") {
      if ("response" in response && typeof response.response === "string") {
        responseText = response.response;
      } else if (
        "choices" in response &&
        Array.isArray(response.choices) &&
        response.choices[0]?.message?.content
      ) {
        responseText = response.choices[0].message.content;
      }
    }

    logger.info(
      {
        toolCallCount,
        responseLength: responseText.length,
      },
      "agent_loop.complete",
    );

    return {
      response: responseText.trim() || "I'm not sure how to help with that.",
      isStream: false,
      toolCallCount,
      debug: {
        model,
        toolCount: tools.length,
        messageCount: messages.length,
      },
    };
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : "unknown",
        toolCallCount,
      },
      "agent_loop.error",
    );

    return {
      response:
        "I encountered an issue processing your request. Could you please try again?",
      isStream: false,
      toolCallCount,
      debug: {
        error: error instanceof Error ? error.message : "unknown",
      },
    };
  }
}

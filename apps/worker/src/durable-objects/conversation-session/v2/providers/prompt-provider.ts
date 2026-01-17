/**
 * Prompt Provider Implementation
 *
 * Builds system prompts for the agent based on current state.
 * This is where agent personality and behavior is defined.
 */

import type { AgentPromptConfig } from "@pestcall/core";
import type { PromptProvider, SessionState } from "../types";

/**
 * Configuration for the prompt provider.
 */
export type PromptProviderConfig = {
  /** Agent configuration (persona, company name, tone, etc.) */
  agentConfig: AgentPromptConfig;
};

/**
 * Extract verification state from session.
 */
function isVerified(state: SessionState): boolean {
  const conversation = state.domainState["conversation"] as
    | { verification?: { verified?: boolean } }
    | undefined;
  return conversation?.verification?.verified ?? false;
}

/**
 * Check if there's an active workflow.
 */
function hasActiveWorkflow(state: SessionState): boolean {
  return (
    Boolean(state.domainState["rescheduleWorkflowId"]) ||
    Boolean(state.domainState["cancelWorkflowId"]) ||
    Boolean(state.domainState["activeSelection"])
  );
}

/**
 * Build workflow context string if a workflow is active.
 */
function buildWorkflowContext(state: SessionState): string | null {
  const ds = state.domainState;

  if (ds["activeSelection"]) {
    const selection = ds["activeSelection"] as {
      kind: string;
      options: Array<{ id: string; label: string }>;
      workflowType: string;
    };

    const optionsList = selection.options
      .map((opt, i) => `${i + 1}. ${opt.label}`)
      .join("\n");

    if (selection.kind === "appointment") {
      return `Customer is selecting an appointment for ${selection.workflowType}:\n${optionsList}`;
    }
    if (selection.kind === "slot") {
      return `Customer is selecting a time slot:\n${optionsList}`;
    }
    if (selection.kind === "confirmation") {
      return `Waiting for customer to confirm or decline the ${selection.workflowType}.`;
    }
  }

  if (ds["rescheduleWorkflowId"]) {
    return "Customer is in a reschedule workflow. Help them complete it.";
  }

  if (ds["cancelWorkflowId"]) {
    return "Customer is in a cancellation workflow. Help them complete it.";
  }

  return null;
}

/**
 * Create a PromptProvider with the given configuration.
 *
 * Usage:
 * ```ts
 * const promptProvider = createPromptProvider({
 *   agentConfig: await deps.agentConfig.get(defaults),
 * });
 * ```
 */
export function createPromptProvider(
  config: PromptProviderConfig,
): PromptProvider {
  const { agentConfig } = config;

  return {
    getGreeting: (): string => {
      return agentConfig.greeting;
    },

    buildSystemPrompt: (state: SessionState): string => {
      const verified = isVerified(state);
      const activeWorkflow = hasActiveWorkflow(state);
      const workflowContext = buildWorkflowContext(state);

      const lines: string[] = [
        agentConfig.personaSummary,
        `Company: ${agentConfig.companyName}.`,
        `Tone: ${agentConfig.tone}.`,
        "",
        "## Current State",
        `- Customer verified: ${verified ? "yes" : "no"}`,
        `- Active workflow: ${activeWorkflow ? "yes" : "no"}`,
        "",
      ];

      if (!verified) {
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

      if (activeWorkflow && workflowContext) {
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
        `- ${agentConfig.scopeMessage}`,
        "",
        "## Conversational Awareness",
        '- When the customer repeats or confirms information you just gave them (e.g., "Tomorrow at 8am?"), they\'re confirming understanding. Just say "Yes, that\'s right!" or similar - do NOT re-explain or call tools again.',
        '- When the customer says goodbye ("Bye!", "Thanks, bye!", "Have a good one!"), respond warmly and briefly. Do NOT call any tools or mention appointments.',
        "- Match the energy of the conversation - if winding down, keep responses short.",
        "- Avoid repeating the same information multiple times in a conversation.",
        "",
        "## Tool Usage",
        "- When you call a tool, you'll receive the result automatically",
        "- You can call multiple tools if needed",
        "- After getting tool results, formulate a natural response",
        "- Do NOT call tools for social pleasantries (greetings, confirmations, goodbyes)",
      );

      return lines.join("\n");
    },
  };
}

/**
 * Create a minimal prompt provider (for testing).
 */
export function createMinimalPromptProvider(): PromptProvider {
  return {
    getGreeting: () => "Hello, how can I help you?",
    buildSystemPrompt: () => "You are a helpful assistant.",
  };
}

/**
 * Create a custom prompt provider with a builder function.
 */
export function createCustomPromptProvider(
  builder: (state: SessionState) => string,
  greeting = "Hello, how can I help you?",
): PromptProvider {
  return {
    getGreeting: () => greeting,
    buildSystemPrompt: builder,
  };
}

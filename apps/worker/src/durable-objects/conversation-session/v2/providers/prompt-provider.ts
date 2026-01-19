/**
 * Prompt Provider Implementation
 *
 * Builds system prompts for the agent based on current state.
 * This is where agent personality and behavior is defined.
 */

import type { AgentPromptConfig } from "@pestcall/core";
import type { KnowledgeRetriever } from "../../../../rag";
import type { PromptProvider, SessionState } from "../types";

/**
 * Configuration for the prompt provider.
 */
export type PromptProviderConfig = {
  /** Agent configuration (persona, company name, tone, etc.) */
  agentConfig: AgentPromptConfig;
  /** Optional knowledge retriever for RAG */
  knowledgeRetriever?: KnowledgeRetriever;
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
 *   knowledgeRetriever: createKnowledgeRetriever({ ai, vectorize }),
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

    buildSystemPrompt: async (state: SessionState): Promise<string> => {
      const verified = isVerified(state);
      const activeWorkflow = hasActiveWorkflow(state);
      const workflowContext = buildWorkflowContext(state);

      // Use minimal, focused prompts for function calling
      // The Hermes model works better with shorter prompts
      if (!verified) {
        return [
          `You are a friendly ${agentConfig.companyName} customer service agent on a phone call.`,
          "",
          "CRITICAL: You MUST verify the customer before helping them.",
          "",
          "STEP 1 - ASK FOR ZIP (do NOT call any tools yet):",
          "- Greet the customer warmly",
          "- Ask for their ZIP code to pull up their account",
          '- Example: "Hi there! I\'d be happy to help. Could you please provide your ZIP code so I can pull up your account?"',
          "",
          "STEP 2 - VERIFY (only after customer provides a 5-digit ZIP):",
          "- When customer provides a ZIP code (5 digits like 98109 or 94107), call crm.verifyAccount with that ZIP",
          "- After verification succeeds, greet them by name and ask how you can help",
          "- If verification fails, kindly ask them to try again with the correct ZIP",
          "",
          "IMPORTANT RULES:",
          "- Do NOT call crm.verifyAccount until the customer gives you a 5-digit ZIP code",
          "- If the customer says something other than a ZIP code, acknowledge and ask again for their ZIP",
          "- Never say 'I'm not sure how to respond' - always acknowledge and guide the conversation",
          "",
          "RESPONSE FORMAT (THIS IS A PHONE CALL):",
          "- Speak naturally as if on a phone - no markdown, bullets, numbered lists, or formatting",
          "- Say dates casually: 'February 10th' not 'February 10, 2025'",
          "- Say times casually: 'between 10 and noon' not '10:00 AM - 12:00 PM'",
          "- Never start with 'I understand that...' - just address their request directly",
          "- Keep responses brief and conversational",
        ].join("\n");
      }

      // Build a short, focused prompt for verified customers
      const lines: string[] = [
        `You are a helpful ${agentConfig.companyName} customer service agent on a phone call.`,
        "The customer is VERIFIED. You have full access to their account.",
        "",
        "APPOINTMENT WORKFLOW:",
        "1. FIRST: Call crm.listUpcomingAppointments to get their appointments",
        "2. Tell customer what appointments they have (date, time, address)",
        "3. When they confirm cancel/reschedule, use crm.cancelAppointment or crm.rescheduleAppointment",
        "   with the EXACT id from step 1 (like 'appt_002', NOT made-up IDs like '123' or '12345')",
        "",
        "RESPONSE FORMAT (THIS IS A PHONE CALL):",
        "- Speak naturally as if on a phone - no markdown, bullets, numbered lists, or formatting",
        "- Say dates casually: 'February 10th' not 'February 10, 2025'",
        "- Say times casually: 'between 10 and noon' not '10:00 AM - 12:00 PM'",
        "- Never mention appointment IDs to customers - just describe the appointment",
        "- Never start with 'I understand that...' - just address their request directly",
        "- Keep responses brief and conversational - one or two sentences when possible",
        "",
        "CRITICAL RULES:",
        "- Appointment IDs look like 'appt_001', 'appt_002'. ONLY use IDs from crm.listUpcomingAppointments results",
        "- NEVER invent/make up appointment IDs - get them from tool results first",
        "- NEVER ask customer for IDs or verification info - look it up yourself",
        "- NEVER mention tool names to customers",
      ];

      // Add workflow context if active
      if (activeWorkflow && workflowContext) {
        lines.push("", `ACTIVE WORKFLOW: ${workflowContext}`);
      }

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
    buildSystemPrompt: async () => "You are a helpful assistant.",
  };
}

/**
 * Create a custom prompt provider with a builder function.
 */
export function createCustomPromptProvider(
  builder: (
    state: SessionState,
    userMessage?: string,
  ) => string | Promise<string>,
  greeting = "Hello, how can I help you?",
): PromptProvider {
  return {
    getGreeting: () => greeting,
    buildSystemPrompt: async (state, userMessage) =>
      builder(state, userMessage),
  };
}

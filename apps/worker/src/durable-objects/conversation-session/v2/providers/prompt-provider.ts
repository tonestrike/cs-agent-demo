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
  const { agentConfig, knowledgeRetriever } = config;

  return {
    getGreeting: (): string => {
      return agentConfig.greeting;
    },

    buildSystemPrompt: async (
      state: SessionState,
      userMessage?: string,
    ): Promise<string> => {
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

      if (verified) {
        lines.push(
          "## Verified Customer (IMPORTANT)",
          "The customer is ALREADY VERIFIED. You have full access to their account.",
          "",
          "DO NOT ask for:",
          "- Address confirmation",
          "- Phone number",
          "- ZIP code",
          "- Name confirmation",
          "- Any other account verification details",
          "",
          "When the customer asks about appointments, reschedule, cancel, or account info:",
          "- Use your tools DIRECTLY to look up the information",
          "- Do NOT ask clarifying questions unless truly needed (e.g., they have multiple appointments and you need to know which one)",
          "- Present the information from tool results naturally",
          "",
          'BAD: "Can you please confirm your address so I can look that up?"',
          'GOOD: "Let me pull up your appointments." *calls tool* "I see you have..."',
          "",
        );
      } else {
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

      // RAG: Inject relevant knowledge if retriever is available and we have a user message
      if (knowledgeRetriever && userMessage) {
        try {
          const results = await knowledgeRetriever.retrieve(userMessage, 3);

          if (results.chunks.length > 0) {
            lines.push(
              "## Relevant Knowledge",
              "Use this information to help answer the customer's question:",
              "",
            );

            for (const chunk of results.chunks) {
              lines.push(`### ${chunk.metadata.section}`, chunk.content, "");
            }
          }
        } catch {
          // Silently fail if RAG retrieval fails - agent can still respond without it
        }
      }

      lines.push(
        "## Guidelines",
        "- Call tools when you need information or need to take action",
        "- Keep responses warm, concise, and conversational",
        "- Never mention tool names or internal systems to the customer",
        "- If you don't have access to a tool you need, explain why (e.g., need verification)",
        `- ${agentConfig.scopeMessage}`,
        "",
        "## Voice Output (CRITICAL)",
        "Your responses will be read aloud via text-to-speech. Format everything for natural speech:",
        '- Time ranges: "from 1 to 3pm" NOT "1-3pm"',
        '- Dates: "January 15th" NOT "1/15" or "Jan 15"',
        '- Numbers: "five" for small numbers, digits for larger ones',
        '- Addresses: Read naturally, "123 Main Street" NOT "123 Main St."',
        '- Abbreviations: Expand them - "appointment" NOT "appt", "minutes" NOT "mins"',
        "- Avoid symbols that don't speak well: &, /, #, etc.",
        '- Lists: Use "and" before the last item, pause naturally',
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
        "",
        "## Response Format (CRITICAL)",
        "- Your response MUST be natural conversational language only",
        "- NEVER output JSON, code, or structured data in your response",
        '- NEVER write tool calls as text like {"type": "function"...}',
        "- If unsure whether to call a tool, respond conversationally instead",
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

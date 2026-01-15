import type { Ai, AiModels } from "@cloudflare/workers-types";
import { AppError } from "@pestcall/core";

import type { AgentPromptConfig } from "@pestcall/core";
import {
  type AgentModelInput,
  type AgentResponseInput,
  type ModelAdapter,
  agentModelOutputSchema,
} from "./types";

const responseToText = (response: unknown) => {
  if (
    response &&
    typeof response === "object" &&
    "response" in response &&
    typeof (response as { response?: unknown }).response === "string"
  ) {
    return (response as { response: string }).response;
  }

  if (
    response &&
    typeof response === "object" &&
    "choices" in response &&
    Array.isArray((response as { choices?: unknown }).choices)
  ) {
    const choice = (response as { choices: Array<{ message?: unknown }> })
      .choices[0];
    if (
      choice?.message &&
      typeof (choice.message as { content?: unknown }).content === "string"
    ) {
      return (choice.message as { content: string }).content;
    }
  }

  return null;
};

const buildToolGuidanceLines = (config: AgentPromptConfig) => {
  return [
    "Tool guidance:",
    `- crm.getNextAppointment: ${config.toolGuidance.getNextAppointment}`,
    `- crm.getOpenInvoices: ${config.toolGuidance.getOpenInvoices}`,
    `- crm.rescheduleAppointment: ${config.toolGuidance.rescheduleAppointment}`,
    `- agent.escalate: ${config.toolGuidance.escalate}`,
  ];
};

const buildPrompt = (input: AgentModelInput, config: AgentPromptConfig) => {
  const lines = [
    config.personaSummary,
    `Company: ${config.companyName}.`,
    `Tone: ${config.tone}.`,
    `Use this greeting only for the first turn when the caller just says hello: ${config.greeting}`,
    "Return JSON only, no prose.",
    "Choose one tool call or a final response.",
    ...buildToolGuidanceLines(config),
    `If out of scope, respond politely. Guidance: ${config.scopeMessage}`,
    "If the request is vague, ask how you can help without calling tools.",
    "If hasContext is true, do not repeat the greeting or reintroduce yourself.",
  ];

  if (input.context) {
    lines.push("Conversation so far:", input.context);
  }

  lines.push(
    `Customer: ${input.customer.displayName} (${input.customer.phoneE164})`,
    `HasContext: ${input.hasContext ? "true" : "false"}`,
    `User: ${input.text}`,
    "JSON format:",
    '{"type":"tool_call","toolName":"crm.getNextAppointment","arguments":{"customerId":"cust_001"}}',
    '{"type":"final","text":"..."}',
  );

  return lines.join("\n");
};

export const createWorkersAiAdapter = (
  ai: Ai | undefined,
  model: string,
  config: AgentPromptConfig,
): ModelAdapter => {
  if (!ai) {
    throw new AppError("AI binding not configured", { code: "config_error" });
  }

  return {
    name: "workers-ai",
    modelId: model,
    async generate(input: AgentModelInput) {
      if (!ai) {
        throw new AppError("Workers AI binding is not configured.", {
          code: "AI_NOT_CONFIGURED",
        });
      }

      const prompt = buildPrompt(input, config);
      const response = await ai.run(model as keyof AiModels, {
        messages: [
          { role: "system", content: config.personaSummary },
          { role: "user", content: prompt },
        ],
      });
      const text = responseToText(response);
      if (!text) {
        return {
          type: "final",
          text: "I could not interpret the request. Can you rephrase?",
        };
      }
      try {
        const parsed = JSON.parse(text) as unknown;
        const validated = agentModelOutputSchema.safeParse(parsed);
        if (validated.success) {
          return validated.data;
        }
      } catch {
        // fall through
      }
      return {
        type: "final",
        text: "I could not interpret the request. Can you rephrase?",
      };
    },
    async respond(input: AgentResponseInput) {
      if (!ai) {
        throw new AppError("Workers AI binding is not configured.", {
          code: "AI_NOT_CONFIGURED",
        });
      }

      const promptLines = [
        config.personaSummary,
        `Company: ${config.companyName}.`,
        `Tone: ${config.tone}.`,
        `Use this greeting only for the first turn when the caller just says hello: ${config.greeting}`,
        "Respond in 1-2 short sentences.",
        "Use the tool result to answer the customer.",
        "Do not mention internal tool names.",
        ...buildToolGuidanceLines(config),
        `If out of scope, respond politely. Guidance: ${config.scopeMessage}`,
        "If hasContext is true, do not repeat the greeting or reintroduce yourself.",
      ];

      if (input.context) {
        promptLines.push("Conversation so far:", input.context);
      }

      promptLines.push(
        `Customer: ${input.customer.displayName} (${input.customer.phoneE164})`,
        `HasContext: ${input.hasContext ? "true" : "false"}`,
        `User: ${input.text}`,
        `Tool: ${input.toolName}`,
        `Tool Result: ${JSON.stringify(input.result)}`,
      );

      const prompt = promptLines.join("\n");

      const response = await ai.run(model as keyof AiModels, {
        messages: [
          { role: "system", content: config.personaSummary },
          { role: "user", content: prompt },
        ],
      });
      const text = responseToText(response);
      return text ?? "Thanks for the details. How else can I help?";
    },
  };
};

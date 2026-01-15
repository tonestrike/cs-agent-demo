import type { Ai, AiModels } from "@cloudflare/workers-types";
import { AppError } from "@pestcall/core";

import {
  type AgentModelInput,
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

const buildPrompt = (input: AgentModelInput) => {
  return [
    "You are a pest control support agent.",
    "Return JSON only, no prose.",
    "Choose one tool call or a final response.",
    "Tools: crm.getNextAppointment, crm.getOpenInvoices, agent.escalate.",
    "If you cannot answer, return a final message asking a clarifying question.",
    `Customer: ${input.customer.displayName} (${input.customer.phoneE164})`,
    `User: ${input.text}`,
    "JSON format:",
    '{"type":"tool_call","toolName":"crm.getNextAppointment","arguments":{"customerId":"cust_001"}}',
    '{"type":"final","text":"..."}',
  ].join("\n");
};

export const createWorkersAiAdapter = (
  ai: Ai | undefined,
  model = "@cf/meta/llama-3.1-8b-instruct",
): ModelAdapter => {
  if (!ai) {
    throw new AppError("AI binding not configured", { code: "config_error" });
  }

  return {
    async generate(input: AgentModelInput) {
      if (!ai) {
        throw new AppError("Workers AI binding is not configured.", {
          code: "AI_NOT_CONFIGURED",
        });
      }

      const prompt = buildPrompt(input);
      const response = await ai.run(model as keyof AiModels, {
        messages: [
          { role: "system", content: "You are a helpful assistant." },
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
  };
};

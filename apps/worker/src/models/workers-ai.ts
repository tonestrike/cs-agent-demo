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
    `- crm.lookupCustomerByPhone: ${config.toolGuidance.lookupCustomerByPhone}`,
    `- crm.lookupCustomerByNameAndZip: ${config.toolGuidance.lookupCustomerByNameAndZip}`,
    `- crm.lookupCustomerByEmail: ${config.toolGuidance.lookupCustomerByEmail}`,
    `- crm.verifyAccount: ${config.toolGuidance.verifyAccount}`,
    `- crm.getNextAppointment: ${config.toolGuidance.getNextAppointment}`,
    `- crm.listUpcomingAppointments: ${config.toolGuidance.listUpcomingAppointments}`,
    `- crm.getAppointmentById: ${config.toolGuidance.getAppointmentById}`,
    `- crm.getOpenInvoices: ${config.toolGuidance.getOpenInvoices}`,
    `- crm.getAvailableSlots: ${config.toolGuidance.getAvailableSlots}`,
    `- crm.rescheduleAppointment: ${config.toolGuidance.rescheduleAppointment}`,
    `- crm.createAppointment: ${config.toolGuidance.createAppointment}`,
    `- crm.getServicePolicy: ${config.toolGuidance.getServicePolicy}`,
    `- crm.escalate: ${config.toolGuidance.crmEscalate}`,
    `- agent.escalate: ${config.toolGuidance.escalate}`,
    "- agent.message: Use result.kind and result.details to craft a helpful response.",
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
    "Ask follow-up questions when details are missing.",
    "Never reveal or guess the customer's ZIP code. Only ask the caller to confirm it.",
    "If identity status is verified, do not ask for ZIP again.",
    "Stay on the user's topic; do not fetch appointments unless they ask about scheduling.",
    "Prefer tool calls over assumptions or guesses.",
    "Do not claim actions you did not take.",
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
        "Respond conversationally, keeping it concise and clear.",
        "Use the tool result to answer the customer or ask a follow-up.",
        "Do not mention internal tool names.",
        ...buildToolGuidanceLines(config),
        `If out of scope, respond politely. Guidance: ${config.scopeMessage}`,
        "Never reveal or guess the customer's ZIP code. Only ask the caller to confirm it.",
        "If identity status is verified, do not ask for ZIP again.",
        "If you escalated, clearly say a ticket was created and what happens next.",
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

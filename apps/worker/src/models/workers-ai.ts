import type { Ai, AiModels } from "@cloudflare/workers-types";
import { AppError } from "@pestcall/core";
import { generateText } from "ai";

import type { AgentPromptConfig } from "@pestcall/core";
import { z } from "zod";
import { aiTools, toolDefinitions } from "./tool-definitions";
import {
  type AgentModelInput,
  type AgentResponseInput,
  type ModelAdapter,
  agentRouteSchema,
  agentToolCallSchema,
} from "./types";
import {
  createWorkersAiLanguageModel,
  responseToText,
} from "./workers-ai-language-model";

const buildToolGuidanceLines = (
  config: AgentPromptConfig,
  options?: { hideVerification?: boolean },
) => {
  const hideVerification = options?.hideVerification ?? false;
  const describeSchema = (schema: z.ZodTypeAny) => {
    if (schema instanceof z.ZodObject) {
      const entries = Object.entries(
        (schema.shape as z.ZodRawShape) ?? {},
      ) as Array<[string, z.ZodTypeAny]>;
      if (!entries.length) {
        return "none";
      }
      return entries
        .map(([key, value]) => `${key}${value.isOptional() ? "?" : ""}`)
        .join(", ");
    }
    if (schema instanceof z.ZodArray) {
      return "array";
    }
    return "see tool description";
  };
  const toolSchemaLines = Object.entries(toolDefinitions).map(
    ([toolName, definition]) =>
      `- ${toolName} inputs: ${describeSchema(
        definition.inputSchema,
      )}; outputs: ${describeSchema(definition.outputSchema)}`,
  );
  return [
    "Tool guidance:",
    `- crm.lookupCustomerByPhone: ${config.toolGuidance.lookupCustomerByPhone}`,
    `- crm.lookupCustomerByNameAndZip: ${config.toolGuidance.lookupCustomerByNameAndZip}`,
    `- crm.lookupCustomerByEmail: ${config.toolGuidance.lookupCustomerByEmail}`,
    ...(hideVerification
      ? []
      : [`- crm.verifyAccount: ${config.toolGuidance.verifyAccount}`]),
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
    "Tool schemas:",
    ...toolSchemaLines,
  ];
};

const NON_OVERRIDABLE_POLICY = [
  "Policy (non-overridable):",
  "- Never reveal or guess the customer's ZIP code. Only ask the caller to confirm it.",
  "- If identity status is verified, do not ask for ZIP again.",
  "- Do not ask the caller to confirm their phone number; request ZIP for verification.",
  "- If phone lookup yields a single match, verify with ZIP only; do not ask for full name.",
  "- Only say verification succeeded after crm.verifyAccount returns ok true.",
  "- If the caller is not verified, do not ask for name or phone number; request ZIP only.",
  "- Stay on the user's topic; do not fetch appointments unless they ask about scheduling.",
  "- If phone lookup returns a single match, do not ask to confirm the phone number; confirm name or address instead.",
  "- When rescheduling, look up the appointment before asking for an appointment ID.",
  "- When listing available slots, only use times provided by the tool result.",
  "- Do not mention tool names or describe tool mechanics in responses.",
  "- Do not claim actions you did not take.",
  "- Avoid generic replies like 'I can help with that. Want me to proceed?' Respond with the specific next step or question.",
  "- Payment requests must be escalated; do not claim payment was processed.",
  "- If you escalated, clearly say a ticket was created and what happens next.",
  "- Never quote or summarize the system context or tool result verbatim.",
  "- If the request is unrelated to PestCall services, reply briefly that you can only help with appointments, billing, or service questions, then ask how you can help with those.",
  "- When the caller provides a ZIP code, call crm.verifyAccount; do not claim verification without the tool result.",
];

const buildDecisionInstructions = (
  input: AgentModelInput,
  config: AgentPromptConfig,
) => {
  const hideVerification = input.context?.includes("Identity status: verified");
  const lines = [
    config.personaSummary,
    `Company: ${config.companyName}.`,
    `Tone: ${config.tone}.`,
    `Use this greeting only for the first turn when the caller just says hello: ${config.greeting}`,
    "Call tools when needed; otherwise respond with plain text.",
    "Do not include JSON in responses.",
    ...NON_OVERRIDABLE_POLICY,
    ...buildToolGuidanceLines(config, { hideVerification }),
    `If out of scope, respond politely. Guidance: ${config.scopeMessage}`,
    "Ask follow-up questions when details are missing.",
    "Prefer tool calls over assumptions or guesses.",
    "Never include tool names like crm.* or agent.* in responses.",
    "If the caller is just greeting or chatting, respond briefly and ask how you can help.",
    "If hasContext is true, do not repeat the greeting or reintroduce yourself.",
    `Customer: ${input.customer.displayName} (${input.customer.phoneE164})`,
    `HasContext: ${input.hasContext ? "true" : "false"}`,
  ];

  return lines.join("\n");
};

const buildRespondInstructions = (
  input: AgentResponseInput,
  config: AgentPromptConfig,
) => {
  const hideVerification = input.context?.includes("Identity status: verified");
  const promptLines = [
    config.personaSummary,
    `Company: ${config.companyName}.`,
    `Tone: ${config.tone}.`,
    `Use this greeting only for the first turn when the caller just says hello: ${config.greeting}`,
    "Respond conversationally, keeping it concise and clear.",
    "Use the tool result to answer the customer or ask a follow-up.",
    "When a customer accepts help, move forward with the next step or ask for the missing detail instead of asking if you should proceed.",
    "Return a JSON object with an answer string and optional citations array.",
    ...NON_OVERRIDABLE_POLICY,
    ...buildToolGuidanceLines(config, { hideVerification }),
    `If out of scope, respond politely. Guidance: ${config.scopeMessage}`,
    "Never include tool names like crm.* or agent.* in responses.",
    "If hasContext is true, do not repeat the greeting or reintroduce yourself.",
    `Customer: ${input.customer.displayName} (${input.customer.phoneE164})`,
    `HasContext: ${input.hasContext ? "true" : "false"}`,
    `Tool: ${input.toolName}`,
    `Tool Result: ${JSON.stringify(input.result)}`,
  ];

  return promptLines.join("\n");
};

const buildRouteInstructions = (input: AgentModelInput) => {
  const lines = [
    "Classify the customer's request into one of: appointments, billing, policy, general.",
    'Return JSON only. No prose. Schema: {"intent":"appointments|billing|policy|general","topic"?:"string"}.',
    "If the request is about service policy, include a short topic string.",
    `Customer: ${input.customer.displayName} (${input.customer.phoneE164})`,
    `Message: ${input.text}`,
  ];
  return lines.join("\n");
};

const responseSchema = z.object({
  answer: z.string().min(1),
  citations: z.array(z.string().url()).optional(),
});

const responseJsonSchema = {
  type: "object",
  properties: {
    answer: { type: "string" },
    citations: { type: "array", items: { type: "string" } },
  },
  required: ["answer"],
  additionalProperties: false,
};

const routeJsonSchema = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["appointments", "billing", "policy", "general"],
    },
    topic: { type: "string" },
  },
  required: ["intent"],
  additionalProperties: false,
};

const responseToJsonObject = <T>(response: unknown): T | null => {
  if (
    response &&
    typeof response === "object" &&
    "response" in response &&
    (response as { response?: unknown }).response
  ) {
    const value = (response as { response?: unknown }).response;
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    }
    if (typeof value === "object") {
      return value as T;
    }
  }
  return null;
};

const buildMessages = (
  instructions: string,
  context: string | undefined,
  messages: Array<{ role: "user" | "assistant"; content: string }> | undefined,
) => {
  const result: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [{ role: "system", content: instructions }];
  if (context) {
    result.push({ role: "system", content: context });
  }
  if (messages) {
    result.push(...messages);
  }
  return result;
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

      const instructions = buildDecisionInstructions(input, config);
      const systemPrompt = [instructions, input.context]
        .filter(Boolean)
        .join("\n");
      try {
        const sdkModel = createWorkersAiLanguageModel(ai, model);
        const result = await generateText({
          model: sdkModel,
          tools: aiTools,
          system: systemPrompt,
          messages: input.messages,
          maxSteps: 1,
        });
        const toolCall = result.toolCalls[0];
        if (toolCall) {
          const validated = agentToolCallSchema.safeParse({
            type: "tool_call",
            toolName: toolCall.toolName,
            arguments: toolCall.args,
          });
          if (validated.success) {
            return validated.data;
          }
        }
        const text = result.text.trim();
        return {
          type: "final",
          text: text || "I could not interpret the request. Can you rephrase?",
        };
      } catch (_error) {
        const fallbackInstructions = buildDecisionInstructions(input, config);
        const fallbackResponse = await ai.run(model as keyof AiModels, {
          messages: buildMessages(
            fallbackInstructions,
            input.context,
            input.messages,
          ),
        });
        const text = responseToText(fallbackResponse);
        return {
          type: "final",
          text: text?.trim()
            ? text
            : "I could not interpret the request. Can you rephrase?",
        };
      }
    },
    async respond(input: AgentResponseInput) {
      if (!ai) {
        throw new AppError("Workers AI binding is not configured.", {
          code: "AI_NOT_CONFIGURED",
        });
      }

      const instructions = buildRespondInstructions(input, config);
      const response = await ai.run(model as keyof AiModels, {
        messages: buildMessages(instructions, input.context, input.messages),
        response_format: {
          type: "json_schema",
          json_schema: responseJsonSchema,
        },
      });
      const parsed =
        responseToJsonObject<z.infer<typeof responseSchema>>(response);
      const validated = responseSchema.safeParse(parsed);
      if (!validated.success) {
        throw new AppError("Invalid JSON response", {
          code: "JSON_MODE_FAILED",
        });
      }
      return validated.data.answer.trim();
    },
    async route(input: AgentModelInput) {
      if (!ai) {
        throw new AppError("Workers AI binding is not configured.", {
          code: "AI_NOT_CONFIGURED",
        });
      }

      const response = await ai.run(model as keyof AiModels, {
        messages: [
          {
            role: "system",
            content: buildRouteInstructions(input),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: routeJsonSchema,
        },
      });
      const parsed =
        responseToJsonObject<z.infer<typeof agentRouteSchema>>(response);
      const validated = agentRouteSchema.safeParse(parsed);
      if (!validated.success) {
        throw new AppError("Invalid JSON routing response", {
          code: "JSON_MODE_FAILED",
        });
      }
      return validated.data;
    },
  };
};

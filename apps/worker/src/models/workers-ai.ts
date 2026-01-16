import type { Ai, AiModels } from "@cloudflare/workers-types";
import { AppError } from "@pestcall/core";

import type { AgentPromptConfig } from "@pestcall/core";
import { z } from "zod";
import type { Logger } from "../logger";
import { toolDefinitions } from "./tool-definitions";
import {
  type AgentModelInput,
  type AgentResponseInput,
  type ModelAdapter,
  agentRouteSchema,
  agentToolCallSchema,
} from "./types";
import { responseToText } from "./workers-ai-language-model";

const MAX_NEW_TOKENS = 512;

const zodToJsonSchema = (schema: z.ZodTypeAny): Record<string, unknown> => {
  if (schema instanceof z.ZodString) {
    return { type: "string" };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: "number" };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema._def.values };
  }
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: zodToJsonSchema(schema._def.type) };
  }
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema._def.innerType);
  }
  if (schema instanceof z.ZodNullable) {
    const inner = zodToJsonSchema(schema._def.innerType);
    return { anyOf: [inner, { type: "null" }] };
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema._def.shape() as z.ZodRawShape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!value.isOptional()) {
        required.push(key);
      }
    }
    const result: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    } = { type: "object", properties };
    if (required.length) {
      result.required = required;
    }
    return result;
  }
  return { type: "object" };
};

const workersAiTools = Object.entries(toolDefinitions).map(
  ([name, definition]) => ({
    name,
    description: definition.description,
    parameters: zodToJsonSchema(definition.inputSchema),
  }),
);

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
    "- crm.getAvailableSlots: When rescheduling, include appointmentId from the previously listed appointments.",
    `- crm.rescheduleAppointment: ${config.toolGuidance.rescheduleAppointment}`,
    `- crm.cancelAppointment: ${config.toolGuidance.cancelAppointment}`,
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
    "If identity status is pending or there is a single phone match, ask only for the 5-digit ZIP code. Do not ask if they are a new or existing customer.",
    "Never ask whether the caller is a new or existing customer.",
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
    `If out of scope, respond politely. Guidance: ${config.scopeMessage}`,
    "Never include tool names or internal system references in responses.",
    "Do not describe internal actions like checking tools or databases in parentheses.",
    "If hasContext is true, do not repeat the greeting or reintroduce yourself.",
    `Customer: ${input.customer.displayName} (${input.customer.phoneE164})`,
    `HasContext: ${input.hasContext ? "true" : "false"}`,
    "Internal tool result (do not mention internal field names or IDs in the answer):",
    JSON.stringify(input.result),
  ];

  return promptLines.join("\n");
};

const buildRouteInstructions = (input: AgentModelInput) => {
  const lines = [
    "Classify the customer's request into one of: appointments, reschedule, cancel, billing, payment, policy, general.",
    'Return JSON only. No prose. Schema: {"intent":"appointments|reschedule|cancel|billing|payment|policy|general","topic"?:"string"}.',
    "Use reschedule when the caller wants to change or move an existing appointment.",
    "Use cancel when the caller wants to cancel an appointment.",
    "Use payment when the caller wants to pay a balance.",
    "If the request is about service policy, include a short topic string.",
    `Customer: ${input.customer.displayName} (${input.customer.phoneE164})`,
    `Message: ${input.text}`,
  ];
  return lines.join("\n");
};

const buildSelectionInstructions = (
  kind: "appointment" | "slot",
  options: Array<{ label: string }>,
) => {
  const optionLines = options
    .map((option, index) => `${index + 1}) ${option.label}`)
    .join("\n");
  return [
    `Choose the best matching ${kind} option based on the caller's reply.`,
    "Return JSON only. No prose.",
    'Schema: {"index": number | null, "reason"?: string}.',
    "If the reply does not clearly map to a single option, return null.",
    "Options:",
    optionLines || "None",
  ].join("\n");
};

const buildStatusInstructions = (contextHint?: string) => {
  return [
    "Write one short sentence that acknowledges the caller and says you are checking.",
    "Do not mention tools, internal systems, or IDs.",
    "Keep it friendly and concise.",
    contextHint ? `Context: ${contextHint}.` : null,
    'Return JSON only. Schema: {"message":"string"}.',
  ]
    .filter(Boolean)
    .join("\n");
};

const responseSchema = z.object({
  answer: z.string().min(1),
  citations: z.array(z.string().url()).optional(),
});

const selectionSchema = z.object({
  index: z.number().int().nullable(),
  reason: z.string().optional(),
});

const statusSchema = z.object({
  message: z.string().min(1),
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

const selectionJsonSchema = {
  type: "object",
  properties: {
    index: {
      anyOf: [{ type: "integer" }, { type: "null" }],
    },
    reason: { type: "string" },
  },
  required: ["index"],
  additionalProperties: false,
};

const statusJsonSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
  },
  required: ["message"],
  additionalProperties: false,
};

const routeJsonSchema = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: [
        "appointments",
        "reschedule",
        "cancel",
        "billing",
        "payment",
        "policy",
        "general",
      ],
    },
    topic: { type: "string" },
  },
  required: ["intent"],
  additionalProperties: false,
};

const JSON_MODE_MODELS = new Set<string>([
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3.1-70b-instruct",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3-8b-instruct",
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/meta/llama-3.2-11b-vision-instruct",
  "@hf/nousresearch/hermes-2-pro-mistral-7b",
  "@hf/thebloke/deepseek-coder-6.7b-instruct-awq",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
]);

const ensureJsonModeModel = (modelId: string) => {
  if (!JSON_MODE_MODELS.has(modelId)) {
    throw new AppError("JSON Mode model required for structured outputs.", {
      code: "JSON_MODE_UNSUPPORTED",
    });
  }
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
  logger: Logger,
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
      try {
        const toolPayload = {
          messages: buildMessages(instructions, input.context, input.messages),
          tools: workersAiTools,
          max_new_tokens: MAX_NEW_TOKENS,
          max_tokens: MAX_NEW_TOKENS,
        };
        logger.info(
          {
            model,
            max_new_tokens: MAX_NEW_TOKENS,
            max_tokens: MAX_NEW_TOKENS,
            messageCount: toolPayload.messages.length,
            toolCount: toolPayload.tools.length,
          },
          "workers_ai.tool_call.payload",
        );
        const response = await ai.run(model as keyof AiModels, {
          messages: toolPayload.messages,
          tools: toolPayload.tools,
          max_new_tokens: toolPayload.max_new_tokens,
          max_tokens: toolPayload.max_tokens,
        });
        const responseWithTools = response as {
          tool_calls?: Array<{ name: string; arguments?: unknown }>;
        };
        const toolCalls = responseWithTools.tool_calls ?? [];
        const toolCall = toolCalls[0];
        if (toolCall?.name) {
          const validated = agentToolCallSchema.safeParse({
            type: "tool_call",
            toolName: toolCall.name,
            arguments: toolCall.arguments ?? {},
          });
          if (validated.success) {
            return validated.data;
          }
        }
        const text = responseToText(response);
        return {
          type: "final",
          text:
            text?.trim() ||
            "I could not interpret the request. Can you rephrase?",
        };
      } catch {
        const fallbackPayload = {
          messages: buildMessages(instructions, input.context, input.messages),
          max_new_tokens: MAX_NEW_TOKENS,
          max_tokens: MAX_NEW_TOKENS,
        };
        logger.info(
          {
            model,
            max_new_tokens: MAX_NEW_TOKENS,
            max_tokens: MAX_NEW_TOKENS,
            messageCount: fallbackPayload.messages.length,
          },
          "workers_ai.tool_call.fallback_payload",
        );
        const fallbackResponse = await ai.run(model as keyof AiModels, {
          messages: fallbackPayload.messages,
          max_new_tokens: fallbackPayload.max_new_tokens,
          max_tokens: fallbackPayload.max_tokens,
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

      ensureJsonModeModel(model);
      const instructions = buildRespondInstructions(input, config);
      logger.info(
        {
          model,
          max_new_tokens: MAX_NEW_TOKENS,
          max_tokens: MAX_NEW_TOKENS,
          messageCount: 1 + (input.messages?.length ?? 0),
        },
        "workers_ai.respond.payload",
      );
      const response = await ai.run(model as keyof AiModels, {
        messages: buildMessages(instructions, input.context, input.messages),
        response_format: {
          type: "json_schema",
          json_schema: responseJsonSchema,
        },
        max_new_tokens: MAX_NEW_TOKENS,
        max_tokens: MAX_NEW_TOKENS,
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

      ensureJsonModeModel(model);
      logger.info(
        {
          model,
          max_new_tokens: MAX_NEW_TOKENS,
          max_tokens: MAX_NEW_TOKENS,
        },
        "workers_ai.route.payload",
      );
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
        max_new_tokens: MAX_NEW_TOKENS,
        max_tokens: MAX_NEW_TOKENS,
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
    async selectOption(input) {
      if (!ai) {
        throw new AppError("Workers AI binding is not configured.", {
          code: "AI_NOT_CONFIGURED",
        });
      }

      ensureJsonModeModel(model);
      logger.info(
        {
          model,
          max_new_tokens: MAX_NEW_TOKENS,
          max_tokens: MAX_NEW_TOKENS,
          optionCount: input.options.length,
          kind: input.kind,
        },
        "workers_ai.select.payload",
      );
      const response = await ai.run(model as keyof AiModels, {
        messages: [
          {
            role: "system",
            content: buildSelectionInstructions(
              input.kind,
              input.options.map((option) => ({ label: option.label })),
            ),
          },
          {
            role: "user",
            content: input.text,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: selectionJsonSchema,
        },
        max_new_tokens: MAX_NEW_TOKENS,
        max_tokens: MAX_NEW_TOKENS,
      });
      const parsed =
        responseToJsonObject<z.infer<typeof selectionSchema>>(response);
      const validated = selectionSchema.safeParse(parsed);
      if (!validated.success) {
        throw new AppError("Invalid JSON selection response", {
          code: "JSON_MODE_FAILED",
        });
      }
      const index = validated.data.index;
      if (!index || index < 1 || index > input.options.length) {
        return { selectedId: null, index: null, reason: validated.data.reason };
      }
      return {
        selectedId: input.options[index - 1]?.id ?? null,
        index,
        reason: validated.data.reason,
      };
    },
    async status(input) {
      if (!ai) {
        throw new AppError("Workers AI binding is not configured.", {
          code: "AI_NOT_CONFIGURED",
        });
      }

      ensureJsonModeModel(model);
      logger.info(
        {
          model,
          max_new_tokens: MAX_NEW_TOKENS,
          max_tokens: MAX_NEW_TOKENS,
          contextHint: input.contextHint ?? null,
        },
        "workers_ai.status.payload",
      );
      const response = await ai.run(model as keyof AiModels, {
        messages: [
          {
            role: "system",
            content: buildStatusInstructions(input.contextHint),
          },
          {
            role: "user",
            content: input.text,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: statusJsonSchema,
        },
        max_new_tokens: MAX_NEW_TOKENS,
        max_tokens: MAX_NEW_TOKENS,
      });
      const parsed =
        responseToJsonObject<z.infer<typeof statusSchema>>(response);
      const validated = statusSchema.safeParse(parsed);
      if (!validated.success) {
        throw new AppError("Invalid JSON status response", {
          code: "JSON_MODE_FAILED",
        });
      }
      return validated.data.message.trim();
    },
  };
};

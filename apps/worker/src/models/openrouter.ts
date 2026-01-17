import type { AgentPromptConfig } from "@pestcall/core";
import { AppError } from "@pestcall/core";
import { z } from "zod";
import type { Env } from "../env";
import type { Logger } from "../logger";
import { toolDefinitions } from "./tool-definitions";
import {
  type AgentModelInput,
  type AgentResponseInput,
  type AgentRouteDecision,
  type ModelAdapter,
  agentRouteSchema,
  agentToolCallSchema,
} from "./types";

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

const openRouterTools = Object.entries(toolDefinitions).map(
  ([name, definition]) => ({
    type: "function",
    function: {
      name,
      description: definition.description,
      parameters: zodToJsonSchema(definition.inputSchema),
    },
  }),
);

const buildToolGuidanceLines = (
  config: AgentPromptConfig,
  options?: { hideVerification?: boolean },
) => {
  const hideVerification = options?.hideVerification ?? false;
  const describeSchema = (schema: z.ZodTypeAny) => {
    if (schema instanceof z.ZodObject) {
      const entries = Object.entries(schema._def.shape() as z.ZodRawShape).map(
        ([key, value]) => `${key}: ${value._def.typeName}`,
      );
      return entries.join(", ");
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
  "- Use warm, natural language; avoid robotic phrases like 'verification succeeded' or 'to get started'.",
  "- Prefer short, friendly sentences that sound human.",
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
    "If you call a tool, include a short acknowledgement in the assistant response content as plain text.",
    "Keep the tone friendly, warm, and conversational.",
    ...NON_OVERRIDABLE_POLICY,
    ...buildToolGuidanceLines(config, { hideVerification }),
    "If identity status is pending or there is a single phone match, ask only for the 5-digit ZIP code. Do not ask if they are a new or existing customer.",
    "Never ask whether the caller is a new or existing customer.",
    `If out of scope, respond politely. Guidance: ${config.scopeMessage}`,
    "Ask follow-up questions when details are missing.",
    "Prefer tool calls over assumptions or guesses.",
    "Never include tool names like crm.* or agent.* in responses.",
    "Avoid repeating acknowledgements back-to-back.",
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
    "Respond conversationally, keeping it concise, warm, and clear.",
    "Use the tool result to answer the customer or ask a follow-up.",
    "When a customer accepts help, move forward with the next step or ask for the missing detail instead of asking if you should proceed.",
    "Respond with plain text only. Do not return JSON.",
    ...NON_OVERRIDABLE_POLICY,
    `If out of scope, respond politely. Guidance: ${config.scopeMessage}`,
    "Never include tool names or internal system references in responses.",
    "Do not describe internal actions like checking tools or databases in parentheses.",
    "Avoid stiff phrases like 'verification succeeded' or 'to get started'.",
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
  kind: "appointment" | "slot" | "confirmation",
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
    "You are a friendly, helpful assistant.",
    "Write one short, warm sentence that acknowledges the caller and says you are looking into their request.",
    "Sound human and supportive; avoid robotic phrasing like 'checking now'.",
    "Do not stack multiple acknowledgements; keep it to a single sentence.",
    "Do not mention tools, internal systems, or IDs.",
    "Keep it concise (one sentence).",
    contextHint ? `Context: ${contextHint}.` : null,
    'Return JSON only. Schema: {"message":"string"}.',
  ]
    .filter(Boolean)
    .join("\n");
};

const extractAcknowledgement = (text: string | null | undefined) => {
  const trimmed = text?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return null;
  }
  return trimmed;
};

const selectionSchema = z.object({
  index: z.number().int().nullable(),
  reason: z.string().optional(),
});

const statusSchema = z.object({
  message: z.string().min(1),
});

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

const responseToText = (response: unknown) => {
  if (
    response &&
    typeof response === "object" &&
    "choices" in response &&
    Array.isArray((response as { choices?: unknown }).choices)
  ) {
    const choice = (response as { choices: Array<{ message?: unknown }> })
      .choices[0];
    if (choice?.message && typeof choice.message === "object") {
      const content = (choice.message as { content?: unknown }).content;
      if (typeof content === "string") {
        return content;
      }
    }
  }
  return null;
};

const streamOpenRouterResponse = async function* (
  response: Response,
  logger: Logger,
): AsyncIterable<string> {
  if (!response.body) {
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventData: string[] = [];

  const flushEvent = async function* () {
    if (!eventData.length) {
      return;
    }
    const payload = eventData.join("\n").trim();
    eventData = [];
    if (!payload || payload === "[DONE]") {
      return;
    }
    logger.debug(
      {
        payload: truncate(payload, 240),
      },
      "openrouter.respond.stream.line",
    );
    try {
      const parsed = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string } }>;
      };
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) {
        logger.debug(
          {
            deltaLength: delta.length,
          },
          "openrouter.respond.stream.delta",
        );
        yield delta;
      }
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : "unknown",
          payload: truncate(payload, 240),
        },
        "openrouter.respond.stream.parse_failed",
      );
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.replace(/\r$/, "");
      if (trimmed === "") {
        yield* flushEvent();
        continue;
      }
      if (trimmed.startsWith("data:")) {
        eventData.push(trimmed.slice("data:".length).trimStart());
      }
    }
  }
  yield* flushEvent();
};

const responseToJsonObject = <T>(
  response: unknown,
  logger: Logger,
): T | null => {
  const text = responseToText(response);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : "unknown",
        payload: truncate(text, 240),
      },
      "openrouter.response.parse_failed",
    );
    return null;
  }
};

const buildGatewayBaseUrl = (env: Env) => {
  const accountId = env.AI_GATEWAY_ACCOUNT_ID;
  const gatewayId = env.AI_GATEWAY_ID;
  if (!accountId || !gatewayId) {
    return null;
  }
  return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/openrouter`;
};

const resolveBaseUrl = (env: Env) =>
  env.OPENROUTER_BASE_URL?.trim() || buildGatewayBaseUrl(env);

const jsonResponseFormat = () => ({
  type: "json_object",
});

const truncate = (value: string, limit = 800) =>
  value.length > limit ? `${value.slice(0, limit)}…` : value;

const hashToken = async (value: string) => {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const requestOpenRouter = async (
  env: Env,
  payload: Record<string, unknown>,
  logger: Logger,
  tag: string,
): Promise<Response | unknown> => {
  const baseUrl = resolveBaseUrl(env);
  const token = env.OPENROUTER_TOKEN;
  if (!baseUrl || !token) {
    throw new AppError("OpenRouter is not configured.", {
      code: "OPENROUTER_NOT_CONFIGURED",
    });
  }
  const tokenHash = await hashToken(token);
  logger.info(
    {
      tag,
      baseUrl,
      hasToken: Boolean(token),
      tokenPrefix: token.slice(0, 6),
      tokenHash: tokenHash.slice(0, 12),
      tokenLength: token.length,
      hasGatewayToken: Boolean(env.AI_GATEWAY_TOKEN),
      hasReferer: Boolean(env.OPENROUTER_REFERER),
      hasTitle: Boolean(env.OPENROUTER_TITLE),
    },
    "openrouter.request.config",
  );
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (baseUrl.includes("gateway.ai.cloudflare.com")) {
    const gatewayToken = env.AI_GATEWAY_TOKEN ?? token;
    headers["cf-aig-authorization"] = `Bearer ${gatewayToken}`;
  }
  if (env.OPENROUTER_REFERER) {
    headers["HTTP-Referer"] = env.OPENROUTER_REFERER;
  }
  if (env.OPENROUTER_TITLE) {
    headers["X-Title"] = env.OPENROUTER_TITLE;
  }
  const endpoint = baseUrl.endsWith("/v1")
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      {
        tag,
        status: response.status,
        statusText: response.statusText,
        errorBody: truncate(errorBody),
      },
      "openrouter.request.failed",
    );
    throw new AppError("OpenRouter request failed.", {
      code: "OPENROUTER_REQUEST_FAILED",
      meta: { errorBody },
    });
  }
  const stream = (payload as { stream?: boolean }).stream;
  if (stream === true) {
    return response;
  }
  return response.json();
};

export const createOpenRouterAdapter = (
  env: Env,
  model: string,
  config: AgentPromptConfig,
  logger: Logger,
): ModelAdapter => {
  return {
    name: "openrouter",
    modelId: model,
    async generate(input: AgentModelInput) {
      const instructions = buildDecisionInstructions(input, config);
      const payload = {
        model,
        messages: buildMessages(instructions, input.context, input.messages),
        tools: openRouterTools,
        tool_choice: "auto",
        max_tokens: MAX_NEW_TOKENS,
      };
      logger.info(
        {
          model,
          max_tokens: MAX_NEW_TOKENS,
          messageCount: payload.messages.length,
          toolCount: openRouterTools.length,
        },
        "openrouter.tool_call.payload",
      );
      const response = await requestOpenRouter(
        env,
        payload,
        logger,
        "generate",
      );
      const toolCalls = (
        response as {
          choices?: Array<{
            message?: { tool_calls?: Array<unknown> };
          }>;
        }
      ).choices?.[0]?.message?.tool_calls;
      const toolCall = Array.isArray(toolCalls) ? toolCalls[0] : null;
      if (toolCall && typeof toolCall === "object") {
        const toolCallObject = toolCall as {
          function?: { name?: string; arguments?: string };
        };
        const toolName = toolCallObject.function?.name;
        if (toolName) {
          const rawArgs = toolCallObject.function?.arguments ?? "{}";
          let parsedArgs: Record<string, unknown> = {};
          if (typeof rawArgs === "string" && rawArgs.trim()) {
            try {
              parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>;
            } catch (error) {
              logger.error(
                {
                  error: error instanceof Error ? error.message : "unknown",
                  rawArgs: truncate(rawArgs, 240),
                },
                "openrouter.tool.args.parse_failed",
              );
              parsedArgs = {};
            }
          }
          const validated = agentToolCallSchema.safeParse({
            type: "tool_call",
            toolName,
            arguments: parsedArgs,
            acknowledgement: extractAcknowledgement(responseToText(response)),
          });
          if (validated.success) {
            return validated.data;
          }
        }
      }
      const text = responseToText(response);
      return {
        type: "final",
        text:
          text?.trim() ||
          "I could not interpret the request. Can you rephrase?",
      };
    },
    async respond(input: AgentResponseInput) {
      const instructions = buildRespondInstructions(input, config);
      logger.info(
        {
          model,
          max_tokens: MAX_NEW_TOKENS,
          messageCount: 1 + (input.messages?.length ?? 0),
        },
        "openrouter.respond.payload",
      );
      const response = await requestOpenRouter(
        env,
        {
          model,
          messages: buildMessages(instructions, input.context, input.messages),
          max_tokens: MAX_NEW_TOKENS,
        },
        logger,
        "respond",
      );
      const text = responseToText(response)?.trim();
      if (text) {
        return text;
      }
      throw new AppError("Empty response from model", {
        code: "RESPOND_EMPTY",
      });
    },
    async *respondStream(input: AgentResponseInput) {
      const instructions = buildRespondInstructions(input, config);
      logger.info(
        {
          model,
          max_tokens: MAX_NEW_TOKENS,
          messageCount: 1 + (input.messages?.length ?? 0),
        },
        "openrouter.respond.stream.payload",
      );
      const response = await requestOpenRouter(
        env,
        {
          model,
          messages: buildMessages(instructions, input.context, input.messages),
          max_tokens: MAX_NEW_TOKENS,
          stream: true,
        },
        logger,
        "respond_stream",
      );
      if (!(response instanceof Response)) {
        throw new AppError("OpenRouter stream response missing.", {
          code: "OPENROUTER_STREAM_MISSING",
        });
      }
      yield* streamOpenRouterResponse(response, logger);
    },
    async route(input: AgentModelInput): Promise<AgentRouteDecision> {
      logger.info(
        {
          model,
          max_tokens: MAX_NEW_TOKENS,
        },
        "openrouter.route.payload",
      );
      const response = await requestOpenRouter(
        env,
        {
          model,
          messages: [
            { role: "system", content: buildRouteInstructions(input) },
          ],
          response_format: jsonResponseFormat(),
          max_tokens: MAX_NEW_TOKENS,
        },
        logger,
        "route",
      );
      const parsed = responseToJsonObject<z.infer<typeof agentRouteSchema>>(
        response,
        logger,
      );
      const validated = agentRouteSchema.safeParse(parsed);
      if (!validated.success) {
        throw new AppError("Invalid JSON routing response", {
          code: "JSON_MODE_FAILED",
        });
      }
      return validated.data;
    },
    async selectOption({ text, options, kind }) {
      logger.info(
        {
          model,
          max_tokens: MAX_NEW_TOKENS,
          optionCount: options.length,
          kind,
        },
        "openrouter.select.payload",
      );
      const response = await requestOpenRouter(
        env,
        {
          model,
          messages: [
            {
              role: "system",
              content: buildSelectionInstructions(kind, options),
            },
            {
              role: "user",
              content: text,
            },
          ],
          response_format: jsonResponseFormat(),
          max_tokens: MAX_NEW_TOKENS,
        },
        logger,
        "select",
      );
      const parsed = responseToJsonObject<z.infer<typeof selectionSchema>>(
        response,
        logger,
      );
      const validated = selectionSchema.safeParse(parsed);
      if (!validated.success) {
        throw new AppError("Invalid JSON selection response", {
          code: "JSON_MODE_FAILED",
        });
      }
      const index =
        typeof validated.data.index === "number" ? validated.data.index : null;
      if (!index || index < 1 || index > options.length) {
        return { selectedId: null, index: null };
      }
      return {
        selectedId: options[index - 1]?.id ?? null,
        index,
      };
    },
    async status({ text, contextHint, context, messages }) {
      logger.info(
        {
          model,
          max_tokens: MAX_NEW_TOKENS,
        },
        "openrouter.status.payload",
      );
      const response = await requestOpenRouter(
        env,
        {
          model,
          messages: [
            ...buildMessages(
              buildStatusInstructions(contextHint),
              context,
              messages,
            ),
            {
              role: "user",
              content: text,
            },
          ],
          response_format: jsonResponseFormat(),
          max_tokens: MAX_NEW_TOKENS,
        },
        logger,
        "status",
      );
      const parsed = responseToJsonObject<z.infer<typeof statusSchema>>(
        response,
        logger,
      );
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

import type { AgentPromptConfig } from "@pestcall/core";
import { AppError } from "@pestcall/core";
import { z } from "zod";
import type { Env } from "../env";
import type { Logger } from "../logger";
import { buildClaudeTools } from "./schema-utils";
import { toolDefinitions } from "./tool-definitions";
import {
  type AgentModelInput,
  type AgentResponseInput,
  type AgentRouteDecision,
  type ModelAdapter,
  type PriorToolCall,
  type ToolResultInput,
  agentRouteSchema,
  agentToolCallSchema,
  agentToolCallsSchema,
} from "./types";

const MAX_NEW_TOKENS = 1024;
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

// Claude tool format
const claudeTools = buildClaudeTools(toolDefinitions);

/**
 * Build tool guidance lines for prompts.
 */
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
  "- Use the ZIP code exactly as the caller provides (including leading zeros); do not normalize, pad, or guess.",
  "- If identity status is verified, do not ask for ZIP again.",
  "- Do not ask the caller to confirm their phone number; request ZIP for verification.",
  "- If phone lookup yields a single match, verify with ZIP only; do not ask for full name.",
  "- Only say verification succeeded after crm.verifyAccount returns ok true.",
  "- If the caller is not verified, do not ask for name or phone number; request ZIP only.",
  "- Stay on the user's topic; do not fetch appointments unless they ask about scheduling.",
  "- If phone lookup returns a single match, do not ask to confirm the phone number; confirm name or address instead.",
  "- When rescheduling, look up the appointment before asking for an appointment ID.",
  "- When listing available slots, only use times provided by the tool result.",
  "- Do not escalate or bring in a specialist unless the caller asks or verification has failed multiple times; never escalate before identity is verified.",
  "- Do not emit acknowledgement/status messages unless a tool is actually running; when asking for verification, skip the acknowledgement and ask for the ZIP.",
  "- Do not mention tool names or describe tool mechanics in responses.",
  "- Never output [tool_call] blocks, JSON objects with 'arguments' or 'name' keys, or any internal syntax in your text response.",
  "- Your text responses must be plain conversational language only - no code, JSON, or markup.",
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
    "Never output [tool_call] blocks, JSON, or any programming syntax in your response.",
    "Do not describe internal actions like checking tools or databases in parentheses.",
    "Avoid stiff phrases like 'verification succeeded' or 'to get started'.",
    "If hasContext is true, do not repeat the greeting or reintroduce yourself.",
    `Customer: ${input.customer.displayName} (${input.customer.phoneE164})`,
    `HasContext: ${input.hasContext ? "true" : "false"}`,
  ];

  // Add context about prior acknowledgement if present
  if (input.priorAcknowledgement) {
    promptLines.push(
      `The customer has already been told: "${input.priorAcknowledgement}"`,
      "Do not repeat this acknowledgement or similar phrasing. Just provide the information they requested.",
    );
  }

  promptLines.push(
    "Internal tool result (do not mention internal field names or IDs in the answer):",
    JSON.stringify(input.result),
  );

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

// Claude message types
type ClaudeMessage = {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
};

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: "tool_result"; tool_use_id: string; content: string };

type ClaudeToolUse = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

type ClaudeResponse = {
  id: string;
  type: "message";
  role: "assistant";
  content: ClaudeContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  usage: { input_tokens: number; output_tokens: number };
};

const selectionSchema = z.object({
  index: z.number().int().nullable(),
  reason: z.string().optional(),
});

const statusSchema = z.object({
  message: z.string().min(1),
});

const truncate = (value: string, limit = 800) =>
  value.length > limit ? `${value.slice(0, limit)}…` : value;

/**
 * Build Claude messages with optional tool result threading.
 *
 * When `priorToolCalls` and `toolResults` are provided, this builds proper
 * Anthropic message threading where:
 * - The assistant message contains tool_use blocks
 * - The user message contains tool_result blocks with matching tool_use_ids
 */
const buildMessages = (
  instructions: string,
  context: string | undefined,
  messages: Array<{ role: "user" | "assistant"; content: string }> | undefined,
  options?: {
    toolResults?: ToolResultInput[];
    priorToolCalls?: PriorToolCall[];
    priorAcknowledgement?: string;
  },
): ClaudeMessage[] => {
  // Claude doesn't have a "system" role in messages, so we combine system content
  // into the first user message or prepend as user message
  const result: ClaudeMessage[] = [];

  // Build combined system content
  const systemContent = context
    ? `${instructions}\n\n${context}`
    : instructions;

  // If there are messages, prepend system as context in first user message
  if (messages && messages.length > 0) {
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;

      if (i === 0 && msg.role === "user") {
        // Prepend system content to first user message
        result.push({
          role: "user",
          content: `[Context]\n${systemContent}\n\n[User Message]\n${msg.content}`,
        });
      } else {
        result.push({ role: msg.role, content: msg.content });
      }
    }
  } else {
    // No messages yet, just create a user message with system content
    result.push({ role: "user", content: systemContent });
  }

  // Handle tool result threading for multi-step tool chains
  const { toolResults, priorToolCalls, priorAcknowledgement } = options ?? {};

  if (
    priorToolCalls &&
    priorToolCalls.length > 0 &&
    toolResults &&
    toolResults.length > 0
  ) {
    // Build assistant message with tool_use blocks (and optional acknowledgement text)
    const assistantContent: ClaudeContentBlock[] = [];

    // Add acknowledgement text if present
    if (priorAcknowledgement) {
      assistantContent.push({ type: "text", text: priorAcknowledgement });
    }

    // Add tool_use blocks for each prior tool call
    for (const toolCall of priorToolCalls) {
      assistantContent.push({
        type: "tool_use",
        id: toolCall.toolUseId,
        name: toolCall.toolName,
        input: toolCall.arguments,
      });
    }

    result.push({
      role: "assistant",
      content: assistantContent,
    });

    // Build user message with tool_result blocks
    const userContent: ClaudeContentBlock[] = [];

    for (const toolResult of toolResults) {
      userContent.push({
        type: "tool_result",
        tool_use_id: toolResult.toolUseId,
        content: toolResult.isError
          ? `Error: ${toolResult.result}`
          : toolResult.result,
      });
    }

    result.push({
      role: "user",
      content: userContent,
    });
  }

  return result;
};

/**
 * Strip tool call text leakage that Claude sometimes outputs as plain text.
 * This removes patterns like `[tool_call]...[/tool_call]` from the response.
 */
const stripToolCallLeakage = (text: string): string => {
  // Remove [tool_call]...[/tool_call] blocks (including Python dict-style content)
  let cleaned = text.replace(/\[tool_call\][\s\S]*?\[\/tool_call\]/gi, "");

  // Remove standalone tool call artifacts like {'arguments': ...} or {"name": "crm.xxx"}
  cleaned = cleaned.replace(
    /\{['"]?(?:arguments|name)['"]?\s*:\s*[\s\S]*?\}\s*/g,
    "",
  );

  // Remove parenthesized action notes like "(Pause for effect)" or "(If the customer...)"
  cleaned = cleaned.replace(
    /\([^)]*(?:pause|checking|looking|moment).*?\)/gi,
    "",
  );

  // Clean up any resulting double spaces or newlines
  cleaned = cleaned
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .trim();

  return cleaned;
};

const extractTextFromResponse = (response: ClaudeResponse): string | null => {
  for (const block of response.content) {
    if (block.type === "text") {
      // Strip any tool call leakage from the text
      const cleaned = stripToolCallLeakage(block.text);
      return cleaned || null;
    }
  }
  return null;
};

const extractToolUses = (response: ClaudeResponse): ClaudeToolUse[] => {
  return response.content.filter(
    (block): block is ClaudeToolUse => block.type === "tool_use",
  );
};

const responseToJsonObject = <T>(
  text: string | null,
  logger: Logger,
): T | null => {
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
      "anthropic.response.parse_failed",
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
  return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/anthropic`;
};

const resolveBaseUrl = (env: Env) =>
  env.ANTHROPIC_BASE_URL?.trim() ||
  buildGatewayBaseUrl(env) ||
  "https://api.anthropic.com";

const requestAnthropic = async (
  env: Env,
  payload: Record<string, unknown>,
  logger: Logger,
  tag: string,
): Promise<Response | ClaudeResponse> => {
  const baseUrl = resolveBaseUrl(env);
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new AppError("Anthropic API key is not configured.", {
      code: "ANTHROPIC_NOT_CONFIGURED",
    });
  }

  logger.info(
    {
      tag,
      baseUrl,
      hasApiKey: Boolean(apiKey),
      apiKeyPrefix: apiKey.slice(0, 10),
    },
    "anthropic.request.config",
  );

  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "Content-Type": "application/json",
  };

  // Add AI Gateway auth header if using gateway
  if (baseUrl.includes("gateway.ai.cloudflare.com")) {
    const gatewayToken = env.AI_GATEWAY_TOKEN ?? apiKey;
    headers["cf-aig-authorization"] = `Bearer ${gatewayToken}`;
  }

  const endpoint = `${baseUrl}/v1/messages`;

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
      "anthropic.request.failed",
    );
    throw new AppError("Anthropic request failed.", {
      code: "ANTHROPIC_REQUEST_FAILED",
      meta: { errorBody },
    });
  }

  const stream = (payload as { stream?: boolean }).stream;
  if (stream === true) {
    return response;
  }

  return response.json() as Promise<ClaudeResponse>;
};

/**
 * Stream Anthropic response using SSE parsing.
 */
const streamAnthropicResponse = async function* (
  response: Response,
  logger: Logger,
): AsyncIterable<string> {
  if (!response.body) {
    return;
  }

  const startAt = Date.now();
  logger.info(
    {
      contentType: response.headers.get("content-type"),
    },
    "anthropic.respond.stream.start",
  );

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventCount = 0;
  let deltaCount = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;

      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        eventCount++;
        try {
          const event = JSON.parse(data) as {
            type: string;
            delta?: { type: string; text?: string };
            content_block?: { type: string; text?: string };
          };

          // Handle content_block_delta events
          if (event.type === "content_block_delta" && event.delta?.text) {
            deltaCount++;
            yield event.delta.text;
          }

          // Handle content_block_start for text blocks
          if (
            event.type === "content_block_start" &&
            event.content_block?.type === "text" &&
            event.content_block.text
          ) {
            yield event.content_block.text;
          }
        } catch (error) {
          logger.debug(
            { data: truncate(data, 100) },
            "anthropic.stream.parse_skip",
            error,
          );
        }
      }
    }
  }

  logger.info(
    {
      eventCount,
      deltaCount,
      durationMs: Date.now() - startAt,
    },
    "anthropic.respond.stream.complete",
  );
};

export const createAnthropicAdapter = (
  env: Env,
  model: string,
  config: AgentPromptConfig,
  logger: Logger,
): ModelAdapter => {
  const modelId = model || env.ANTHROPIC_MODEL_ID || DEFAULT_MODEL;

  return {
    name: "anthropic",
    modelId,
    async generate(input: AgentModelInput) {
      const instructions = buildDecisionInstructions(input, config);
      const messages = buildMessages(
        instructions,
        input.context,
        input.messages,
        {
          toolResults: input.toolResults,
          priorToolCalls: input.priorToolCalls,
          priorAcknowledgement: input.priorAcknowledgement,
        },
      );

      const payload = {
        model: modelId,
        max_tokens: MAX_NEW_TOKENS,
        messages,
        tools: claudeTools.length > 0 ? claudeTools : undefined,
      };

      logger.info(
        {
          model: modelId,
          max_tokens: MAX_NEW_TOKENS,
          messageCount: messages.length,
          toolCount: claudeTools.length,
          hasToolResults: Boolean(input.toolResults?.length),
          hasPriorToolCalls: Boolean(input.priorToolCalls?.length),
        },
        "anthropic.generate.payload",
      );

      const response = await requestAnthropic(env, payload, logger, "generate");

      if (response instanceof Response) {
        throw new AppError("Unexpected streaming response", {
          code: "ANTHROPIC_UNEXPECTED_STREAM",
        });
      }

      const toolUses = extractToolUses(response);
      const responseText = extractTextFromResponse(response);

      logger.info(
        {
          toolCallCount: toolUses.length,
          responseTextPreview: responseText
            ? truncate(responseText, 160)
            : null,
          stopReason: response.stop_reason,
        },
        "anthropic.generate.result",
      );

      // Handle multiple tool calls
      if (toolUses.length > 1) {
        const validated = agentToolCallsSchema.safeParse({
          type: "tool_calls",
          calls: toolUses.map((toolUse) => ({
            toolUseId: toolUse.id, // Preserve ID for tool_result threading
            toolName: toolUse.name,
            arguments: toolUse.input,
          })),
          acknowledgement: responseText ?? undefined,
        });
        if (validated.success) {
          logger.info(
            {
              callCount: toolUses.length,
              toolNames: toolUses.map((t) => t.name),
              toolUseIds: toolUses.map((t) => t.id),
            },
            "anthropic.tool_calls.multiple",
          );
          return validated.data;
        }
      }

      // Handle single tool call
      if (toolUses.length === 1) {
        const toolUse = toolUses[0];
        if (toolUse) {
          const validated = agentToolCallSchema.safeParse({
            type: "tool_call",
            toolUseId: toolUse.id, // Preserve ID for tool_result threading
            toolName: toolUse.name,
            arguments: toolUse.input,
            acknowledgement: responseText ?? undefined,
          });
          if (validated.success) {
            return validated.data;
          }
        }
      }

      // No tool calls - return text response
      return {
        type: "final",
        text: responseText?.trim() || "",
      };
    },

    async respond(input: AgentResponseInput) {
      const instructions = buildRespondInstructions(input, config);
      const messages = buildMessages(
        instructions,
        input.context,
        input.messages,
      );

      logger.info(
        {
          model: modelId,
          max_tokens: MAX_NEW_TOKENS,
          messageCount: messages.length,
        },
        "anthropic.respond.payload",
      );

      const response = await requestAnthropic(
        env,
        {
          model: modelId,
          max_tokens: MAX_NEW_TOKENS,
          messages,
        },
        logger,
        "respond",
      );

      if (response instanceof Response) {
        throw new AppError("Unexpected streaming response", {
          code: "ANTHROPIC_UNEXPECTED_STREAM",
        });
      }

      const text = extractTextFromResponse(response)?.trim();
      if (text) {
        return text;
      }

      throw new AppError("Empty response from model", {
        code: "RESPOND_EMPTY",
      });
    },

    async *respondStream(input: AgentResponseInput) {
      const instructions = buildRespondInstructions(input, config);
      const messages = buildMessages(
        instructions,
        input.context,
        input.messages,
      );

      logger.info(
        {
          model: modelId,
          max_tokens: MAX_NEW_TOKENS,
          messageCount: messages.length,
        },
        "anthropic.respond.stream.payload",
      );

      const response = await requestAnthropic(
        env,
        {
          model: modelId,
          max_tokens: MAX_NEW_TOKENS,
          messages,
          stream: true,
        },
        logger,
        "respond_stream",
      );

      if (!(response instanceof Response)) {
        throw new AppError("Anthropic stream response missing.", {
          code: "ANTHROPIC_STREAM_MISSING",
        });
      }

      yield* streamAnthropicResponse(response, logger);
    },

    async route(input: AgentModelInput): Promise<AgentRouteDecision> {
      const instructions = buildRouteInstructions(input);

      logger.info(
        {
          model: modelId,
          max_tokens: MAX_NEW_TOKENS,
        },
        "anthropic.route.payload",
      );

      const response = await requestAnthropic(
        env,
        {
          model: modelId,
          max_tokens: MAX_NEW_TOKENS,
          messages: [{ role: "user", content: instructions }],
        },
        logger,
        "route",
      );

      if (response instanceof Response) {
        throw new AppError("Unexpected streaming response", {
          code: "ANTHROPIC_UNEXPECTED_STREAM",
        });
      }

      const text = extractTextFromResponse(response);
      const parsed = responseToJsonObject<z.infer<typeof agentRouteSchema>>(
        text,
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
      const instructions = buildSelectionInstructions(kind, options);

      logger.info(
        {
          model: modelId,
          max_tokens: MAX_NEW_TOKENS,
          optionCount: options.length,
          kind,
        },
        "anthropic.select.payload",
      );

      const response = await requestAnthropic(
        env,
        {
          model: modelId,
          max_tokens: MAX_NEW_TOKENS,
          messages: [
            { role: "user", content: instructions },
            { role: "assistant", content: "I will analyze the options." },
            { role: "user", content: text },
          ],
        },
        logger,
        "select",
      );

      if (response instanceof Response) {
        throw new AppError("Unexpected streaming response", {
          code: "ANTHROPIC_UNEXPECTED_STREAM",
        });
      }

      const responseText = extractTextFromResponse(response);
      const parsed = responseToJsonObject<z.infer<typeof selectionSchema>>(
        responseText,
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
      const instructions = buildStatusInstructions(contextHint);

      logger.info(
        {
          model: modelId,
          max_tokens: MAX_NEW_TOKENS,
        },
        "anthropic.status.payload",
      );

      const builtMessages = buildMessages(instructions, context, messages);
      builtMessages.push({ role: "user", content: text });

      const response = await requestAnthropic(
        env,
        {
          model: modelId,
          max_tokens: MAX_NEW_TOKENS,
          messages: builtMessages,
        },
        logger,
        "status",
      );

      if (response instanceof Response) {
        throw new AppError("Unexpected streaming response", {
          code: "ANTHROPIC_UNEXPECTED_STREAM",
        });
      }

      const responseText = extractTextFromResponse(response);
      const parsed = responseToJsonObject<z.infer<typeof statusSchema>>(
        responseText,
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

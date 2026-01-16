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

const sanitizeResponse = (text: string, hasContext: boolean) => {
  const withoutTools = text
    .split("\n")
    .filter(
      (line) =>
        !/(^|\s)(crm|agent)\.[a-zA-Z]/.test(line) &&
        !/^system context:/i.test(line.trim()) &&
        !/^tool result:/i.test(line.trim()) &&
        !/^tool:/i.test(line.trim()) &&
        !/^verified customer:/i.test(line.trim()) &&
        !/^verified zip:/i.test(line.trim()),
    )
    .join("\n")
    .trim();
  if (hasContext && /how can i help today/i.test(withoutTools)) {
    return withoutTools.replace(/.*how can i help today\??\s*/i, "").trim();
  }
  return withoutTools;
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

const NON_OVERRIDABLE_POLICY = [
  "Policy (non-overridable):",
  "- Never reveal or guess the customer's ZIP code. Only ask the caller to confirm it.",
  "- If identity status is verified, do not ask for ZIP again.",
  "- Do not ask the caller to confirm their phone number; request ZIP for verification.",
  "- If phone lookup yields a single match, verify with ZIP only; do not ask for full name.",
  "- Only say verification succeeded after crm.verifyAccount returns ok true.",
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
];

const buildDecisionInstructions = (
  input: AgentModelInput,
  config: AgentPromptConfig,
) => {
  const lines = [
    config.personaSummary,
    `Company: ${config.companyName}.`,
    `Tone: ${config.tone}.`,
    `Use this greeting only for the first turn when the caller just says hello: ${config.greeting}`,
    "Return JSON only, no prose.",
    "Choose one tool call or a final response.",
    ...NON_OVERRIDABLE_POLICY,
    ...buildToolGuidanceLines(config),
    `If out of scope, respond politely. Guidance: ${config.scopeMessage}`,
    "Ask follow-up questions when details are missing.",
    "Prefer tool calls over assumptions or guesses.",
    "Never include tool names like crm.* or agent.* in responses.",
    "If the caller is just greeting or chatting, respond briefly and ask how you can help.",
    "If hasContext is true, do not repeat the greeting or reintroduce yourself.",
    `Customer: ${input.customer.displayName} (${input.customer.phoneE164})`,
    `HasContext: ${input.hasContext ? "true" : "false"}`,
    "JSON format:",
    '{"type":"tool_call","toolName":"crm.getNextAppointment","arguments":{"customerId":"cust_001"}}',
    '{"type":"final","text":"..."}',
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
    ...NON_OVERRIDABLE_POLICY,
    ...buildToolGuidanceLines(config),
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
      const response = await ai.run(model as keyof AiModels, {
        messages: buildMessages(instructions, input.context, input.messages),
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
        text,
      };
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
      });
      const text = responseToText(response);
      if (!text) {
        return "Thanks for the details. How else can I help?";
      }
      return sanitizeResponse(text, Boolean(input.hasContext));
    },
  };
};

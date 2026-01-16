import type { Ai, AiModels } from "@cloudflare/workers-types";
import type { LanguageModelV1, LanguageModelV1Prompt } from "ai";

export const responseToText = (response: unknown) => {
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

const promptToMessages = (prompt: LanguageModelV1Prompt) => {
  return prompt
    .map((message) => {
      const parts = Array.isArray(message.content) ? message.content : [];
      const text = parts
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
        .trim();
      if (!text) {
        return null;
      }
      return { role: message.role, content: text };
    })
    .filter(Boolean) as Array<{ role: string; content: string }>;
};

export const createWorkersAiLanguageModel = (
  ai: Ai,
  modelId: string,
): LanguageModelV1 => {
  const doGenerate: LanguageModelV1["doGenerate"] = async (options) => {
    const messages = promptToMessages(options.prompt);
    const response = await ai.run(modelId as keyof AiModels, { messages });
    const text = responseToText(response);
    return {
      text: text ?? "",
      finishReason: "stop",
      usage: {
        promptTokens: 0,
        completionTokens: 0,
      },
      rawCall: {
        rawPrompt: messages,
        rawSettings: {},
      },
    };
  };

  return {
    specificationVersion: "v1",
    provider: "workers-ai",
    modelId,
    defaultObjectGenerationMode: "json",
    supportsStructuredOutputs: false,
    doGenerate,
    async doStream(options) {
      const result = await doGenerate(options);
      const stream = new ReadableStream({
        start(controller) {
          if (result.text) {
            controller.enqueue({
              type: "text-delta",
              textDelta: result.text,
            });
          }
          controller.enqueue({
            type: "finish",
            finishReason: result.finishReason,
            usage: result.usage,
          });
          controller.close();
        },
      });
      return {
        stream,
        rawCall: result.rawCall,
      };
    },
  };
};

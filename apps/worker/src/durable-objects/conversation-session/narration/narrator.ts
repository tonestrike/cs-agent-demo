/**
 * Narrator module for generating model-based responses
 */

import type { Logger } from "../../../logger";
import type {
  AgentResponseInput,
  SelectionOption,
  ToolResult,
} from "../../../models/types";
import { sanitizeNarratorOutput } from "./sanitizer";

/** Input for agent messages */
export type NarratorInput = {
  text: string;
  phoneNumber: string;
  callSessionId?: string;
};

/** Customer context for narration */
export type NarratorCustomerContext = {
  id: string;
  displayName: string;
  phoneE164: string;
  addressSummary: string;
};

/** Model adapter interface for narration */
export type NarratorModelAdapter = {
  name: string;
  modelId?: string | null;
  respond: (input: AgentResponseInput) => Promise<string>;
  respondStream?: (
    input: AgentResponseInput,
  ) => AsyncGenerator<string, void, unknown>;
  status: (input: {
    text: string;
    contextHint?: string;
    context?: string;
    messages?: Array<{ role: "user" | "assistant"; content: string }>;
  }) => Promise<string>;
  selectOption: (input: {
    text: string;
    options: SelectionOption[];
    kind: "appointment" | "slot" | "confirmation";
  }) => Promise<{ selectedId?: string | null }>;
};

export type NarratorDeps = {
  logger: Logger;
  getModel: () => Promise<NarratorModelAdapter>;
  getCustomerContext: (
    input: NarratorInput,
  ) => Promise<NarratorCustomerContext>;
  getRecentMessages: (
    callSessionId: string,
  ) => Promise<Array<{ role: "user" | "assistant"; content: string }>>;
  buildModelContext: () => string;
  isCanceled: (streamId: number) => boolean;
  emitEvent: (event: { type: string; text?: string }) => void;
  recordModelCall: (
    kind: "generate" | "respond" | "status",
    model: { name: string; modelId?: string | null },
  ) => void;
  recordTurnToken: () => void;
  hasFirstToken: () => boolean;
  getStatusSequence: () => number;
  getCallSessionId: (input: NarratorInput) => string | null;
};

/**
 * Create a narrator instance with injected dependencies
 */
export function createNarrator(deps: NarratorDeps) {
  const {
    logger,
    getModel,
    getCustomerContext,
    getRecentMessages,
    buildModelContext,
    isCanceled,
    emitEvent,
    recordModelCall,
    recordTurnToken,
    hasFirstToken,
    getStatusSequence,
    getCallSessionId,
  } = deps;

  /**
   * Emit tokens word by word for streaming display
   */
  function emitNarratorTokens(
    text: string,
    streamId: number,
    callSessionId: string | null,
  ): void {
    if (isCanceled(streamId)) {
      return;
    }
    const turnStart = Date.now();
    let firstTokenAt: number | null = null;
    const parts = text.split(/\s+/).filter(Boolean);
    if (!parts.length) {
      return;
    }
    for (const part of parts) {
      if (isCanceled(streamId)) {
        return;
      }
      if (firstTokenAt === null) {
        firstTokenAt = Date.now();
        logger.info(
          {
            callSessionId: callSessionId ?? "new",
            first_token_ms: firstTokenAt - turnStart,
          },
          "conversation.session.narrator.first_token",
        );
      }
      emitEvent({ type: "token", text: `${part} ` });
    }
  }

  /**
   * Narrate a tool result using the model
   */
  async function narrateToolResult(
    toolResult: ToolResult,
    options: {
      input: NarratorInput;
      streamId: number;
      fallback: string;
      contextHint?: string;
      messages?: Array<{ role: "user" | "assistant"; content: string }>;
      priorAcknowledgement?: string;
    },
  ): Promise<string> {
    const {
      input,
      streamId,
      fallback,
      contextHint,
      messages,
      priorAcknowledgement,
    } = options;
    const callSessionId = getCallSessionId(input);

    // Parallelize pre-work: model adapter, customer context, and recent messages
    const [model, customer, recentMessages] = await Promise.all([
      getModel(),
      getCustomerContext(input),
      messages
        ? Promise.resolve(messages)
        : callSessionId
          ? getRecentMessages(callSessionId)
          : Promise.resolve([]),
    ]);

    const respondInput: AgentResponseInput = {
      text: input.text,
      customer,
      hasContext: Boolean(input.callSessionId),
      context: contextHint,
      messages: recentMessages,
      priorAcknowledgement,
      ...toolResult,
    };

    recordModelCall("respond", model);
    logger.info(
      {
        callSessionId,
        provider: model.name,
        modelId: model.modelId ?? null,
        kind: "respond",
      },
      "conversation.session.model.call",
    );
    logger.info(
      {
        callSessionId,
        toolName: toolResult.toolName,
        messageCount: recentMessages.length,
        messages: recentMessages,
        contextHint: contextHint ?? null,
      },
      "conversation.session.narrate.input",
    );

    try {
      const respondStart = Date.now();
      let firstTokenMs: number | null = null;

      if (model.respondStream) {
        let combined = "";
        let waitingForJson = false;
        let checkedForJson = false;
        let tokenCount = 0;

        for await (const token of model.respondStream(respondInput)) {
          if (isCanceled(streamId)) {
            logger.info(
              {
                callSessionId,
                toolName: toolResult.toolName,
                tokenCount,
                combinedLength: combined.length,
                waitingForJson,
                respondMs: Date.now() - respondStart,
                firstTokenMs,
                canceled: true,
              },
              "conversation.session.narrate.stream.end",
            );
            return sanitizeNarratorOutput(combined.trim()) || fallback;
          }
          combined += token;
          if (!checkedForJson) {
            const trimmed = combined.trimStart();
            if (trimmed) {
              checkedForJson = true;
              waitingForJson =
                trimmed.startsWith("{") || trimmed.startsWith("[");
              if (waitingForJson) {
                logger.info(
                  {
                    callSessionId,
                    toolName: toolResult.toolName,
                    prefix: trimmed.slice(0, 120),
                  },
                  "conversation.session.narrate.json_detected",
                );
              }
            }
          }
          if (!waitingForJson) {
            tokenCount += 1;
            if (firstTokenMs === null) {
              firstTokenMs = Date.now() - respondStart;
            }
            emitEvent({ type: "token", text: token });
          }
        }

        const sanitized = sanitizeNarratorOutput(combined.trim());
        if (waitingForJson && sanitized) {
          emitNarratorTokens(sanitized, streamId, callSessionId);
        }

        logger.info(
          {
            callSessionId,
            toolName: toolResult.toolName,
            tokenCount,
            combinedLength: combined.length,
            waitingForJson,
            sanitizedLength: sanitized.length,
            respondMs: Date.now() - respondStart,
            firstTokenMs,
          },
          "conversation.session.narrate.stream.end",
        );

        if (!tokenCount && !sanitized) {
          try {
            const directText = await model.respond(respondInput);
            const trimmed = sanitizeNarratorOutput(directText.trim());
            if (trimmed) {
              emitNarratorTokens(trimmed, streamId, callSessionId);
              logger.info(
                {
                  callSessionId,
                  toolName: toolResult.toolName,
                  textLength: trimmed.length,
                },
                "conversation.session.narrate.stream.fallback",
              );
              return trimmed;
            }
          } catch (error) {
            logger.error(
              { error: error instanceof Error ? error.message : "unknown" },
              "conversation.session.narrate.stream.fallback_failed",
            );
          }
        }

        return sanitized || fallback;
      }

      const text = await model.respond(respondInput);
      const trimmed = sanitizeNarratorOutput(text.trim());
      logger.info(
        {
          callSessionId,
          toolName: toolResult.toolName,
          respondMs: Date.now() - respondStart,
          textLength: trimmed.length,
        },
        "conversation.session.narrate.complete",
      );

      if (trimmed) {
        emitNarratorTokens(trimmed, streamId, callSessionId);
        return trimmed;
      }
      return fallback;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "conversation.session.narrate.failed",
      );
      emitNarratorTokens(fallback, streamId, callSessionId);
      return fallback;
    }
  }

  /**
   * Simple wrapper for narrateToolResult with message-type tool
   */
  async function narrateText(
    input: NarratorInput,
    streamId: number,
    fallback: string,
    contextHint?: string,
  ): Promise<string> {
    return narrateToolResult(
      {
        toolName: "agent.message",
        result: {
          kind: "message",
          details: fallback,
        },
      },
      { input, streamId, fallback, contextHint },
    );
  }

  /**
   * Emit an early acknowledgement for verified users
   */
  async function emitEarlyAcknowledgement(
    input: NarratorInput,
    streamId: number,
  ): Promise<void> {
    if (isCanceled(streamId)) {
      return;
    }
    const callSessionId = getCallSessionId(input);
    const ackStart = Date.now();

    try {
      const [model, messages] = await Promise.all([
        getModel(),
        callSessionId ? getRecentMessages(callSessionId) : Promise.resolve([]),
      ]);

      if (isCanceled(streamId)) {
        return;
      }

      // Check if we've already emitted tokens
      if (hasFirstToken() || getStatusSequence() > 0) {
        return;
      }

      const context = buildModelContext();
      recordModelCall("status", model);
      logger.info(
        {
          callSessionId,
          provider: model.name,
          modelId: model.modelId ?? null,
          kind: "early_ack",
        },
        "conversation.session.model.call",
      );

      const statusText = await model.status({
        text: input.text,
        contextHint:
          "Acknowledge the request briefly and naturally while you check. Be friendly and conversational.",
        context,
        messages,
      });

      const ackMs = Date.now() - ackStart;
      logger.info(
        {
          callSessionId,
          ackMs,
          statusLength: statusText?.length ?? 0,
        },
        "conversation.session.early_ack.complete",
      );

      if (isCanceled(streamId)) {
        return;
      }

      // Check again if we've already emitted tokens
      if (hasFirstToken() || getStatusSequence() > 0) {
        return;
      }

      const trimmed = sanitizeNarratorOutput(statusText).trim();
      if (!trimmed) {
        return;
      }

      emitNarratorTokens(trimmed, streamId, callSessionId);
      recordTurnToken();
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "conversation.session.early_ack.failed",
      );
    }
  }

  /**
   * Select an option using the model
   */
  async function selectOption(
    input: NarratorInput,
    kind: "appointment" | "slot" | "confirmation",
    options: SelectionOption[],
  ): Promise<string | null> {
    if (!options.length) {
      return null;
    }
    const model = await getModel();
    try {
      const selection = await model.selectOption({
        text: input.text,
        options,
        kind,
      });
      return selection.selectedId ?? null;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "conversation.session.select.failed",
      );
      return null;
    }
  }

  return {
    narrateText,
    narrateToolResult,
    emitEarlyAcknowledgement,
    emitNarratorTokens,
    selectOption,
  };
}

export type Narrator = ReturnType<typeof createNarrator>;

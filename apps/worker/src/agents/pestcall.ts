import { Agent, type StreamingResponse, callable } from "agents";

import { createDependencies } from "../context";
import type { Env } from "../env";
import { defaultLogger } from "../logging";
import {
  type AgentMessageInput,
  agentMessageInputSchema,
} from "../schemas/agent";
import { handleAgentMessage } from "../use-cases/agent";

type AgentState = {
  lastCallSessionId?: string;
  lastPhoneNumber?: string;
};

type AgentEvent =
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "final"; data: unknown };

const streamReplyChunks = async (
  replyText: string,
  emit: (event: AgentEvent) => void,
) => {
  const chunks = replyText.split(/(\s+)/).filter(Boolean);
  for (const chunk of chunks) {
    emit({ type: "delta", text: chunk });
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const coerceMessageText = (message: unknown) => {
  if (typeof message === "string") {
    return message;
  }
  if (message instanceof ArrayBuffer) {
    return new TextDecoder().decode(message);
  }
  if (message && typeof message === "object" && "text" in message) {
    return String((message as { text?: unknown }).text ?? "");
  }
  return "";
};

const emitReply = async (
  emit: (event: AgentEvent) => void,
  deps: ReturnType<typeof createDependencies>,
  input: AgentMessageInput,
  onState: (response: { callSessionId: string }) => void,
  end?: (event: AgentEvent) => void,
  publish?: (sessionId: string, event: AgentEvent) => void,
) => {
  let lastStatus = "";
  let publishSessionId = input.callSessionId ?? "";
  const publishQueue: AgentEvent[] = [];
  const maybePublish = (event: AgentEvent) => {
    if (!publish) {
      return;
    }
    if (publishSessionId) {
      publish(publishSessionId, event);
      return;
    }
    publishQueue.push(event);
  };

  const response = await handleAgentMessage(deps, input, undefined, {
    onStatus: (status) => {
      const text = status.text.trim();
      if (!text || text === lastStatus) {
        return;
      }
      lastStatus = text;
      const event: AgentEvent = { type: "status", text };
      emit(event);
      maybePublish(event);
    },
  });
  onState(response);
  if (!publishSessionId) {
    publishSessionId = response.callSessionId;
  }
  if (publishQueue.length && publishSessionId && publish) {
    for (const event of publishQueue) {
      publish(publishSessionId, event);
    }
    publishQueue.length = 0;
  }

  await streamReplyChunks(response.replyText, (event) => {
    emit(event);
    maybePublish(event);
  });
  deps.logger.info(
    {
      callSessionId: response.callSessionId,
      replyTextLength: response.replyText.length,
    },
    "agent.stream.final",
  );
  const finalEvent: AgentEvent = { type: "final", data: response };
  maybePublish(finalEvent);
  if (end) {
    end(finalEvent);
  } else {
    emit(finalEvent);
  }
};

export class PestCallAgent extends Agent<Env, AgentState> {
  override initialState: AgentState = {};

  @callable()
  async message(input: AgentMessageInput) {
    const deps = createDependencies(this.env);
    const sessionId = input.callSessionId ?? crypto.randomUUID();
    const normalizedInput = { ...input, callSessionId: sessionId };
    deps.logger.info(
      {
        callSessionId: sessionId ?? "new",
        build: this.env.BUILD_ID ?? null,
      },
      "agent.stream.start",
    );
    const publish = (sessionId: string, event: AgentEvent) => {
      if (!this.env.CONVERSATION_HUB) {
        return;
      }
      const id = this.env.CONVERSATION_HUB.idFromName(sessionId);
      const stub = this.env.CONVERSATION_HUB.get(id);
      void stub.fetch("https://conversation-hub/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });
    };

    const response = await handleAgentMessage(
      deps,
      normalizedInput,
      undefined,
      {
        onStatus: (status) => {
          publish(sessionId, {
            type: "status",
            text: status.text,
          });
        },
      },
    );
    this.setState({
      lastCallSessionId: response.callSessionId,
      lastPhoneNumber: input.phoneNumber,
    });
    void (async () => {
      await streamReplyChunks(response.replyText, (event) => {
        publish(response.callSessionId, event);
      });
      publish(response.callSessionId, { type: "final", data: response });
    })();
    return response;
  }

  @callable({ streaming: true })
  async messageStream(stream: StreamingResponse, input: AgentMessageInput) {
    const deps = createDependencies(this.env);
    deps.logger.info(
      {
        callSessionId: input.callSessionId ?? "new",
        build: this.env.BUILD_ID ?? null,
      },
      "agent.stream.start",
    );
    const publish = (sessionId: string, event: AgentEvent) => {
      if (!this.env.CONVERSATION_HUB) {
        return;
      }
      const id = this.env.CONVERSATION_HUB.idFromName(sessionId);
      const stub = this.env.CONVERSATION_HUB.get(id);
      void stub.fetch("https://conversation-hub/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });
    };

    await emitReply(
      (event) => {
        stream.send(event);
      },
      deps,
      input,
      (response) => {
        this.setState({
          lastCallSessionId: response.callSessionId,
          lastPhoneNumber: input.phoneNumber,
        });
      },
      (event) => {
        stream.end(event);
      },
      publish,
    );
  }

  override async onConnect(connection: { send: (data: string) => void }) {
    connection.send(JSON.stringify({ type: "ready" }));
  }

  override async onMessage(
    connection: { send: (data: string) => void },
    message: unknown,
  ) {
    const rawText = coerceMessageText(message);
    const parsed = rawText
      ? (() => {
          try {
            return JSON.parse(rawText) as unknown;
          } catch (error) {
            defaultLogger.warn(
              { error: error instanceof Error ? error.message : "unknown" },
              "agent.message.parse_failed",
            );
            return null;
          }
        })()
      : null;

    const base =
      parsed && typeof parsed === "object"
        ? (parsed as Partial<AgentMessageInput>)
        : null;

    const candidate = base
      ? {
          ...base,
          phoneNumber: base.phoneNumber ?? this.state.lastPhoneNumber,
          callSessionId: base.callSessionId ?? this.state.lastCallSessionId,
        }
      : this.state.lastPhoneNumber
        ? { phoneNumber: this.state.lastPhoneNumber, text: rawText }
        : null;

    const validation = agentMessageInputSchema.safeParse(candidate);
    if (!validation.success) {
      connection.send(
        JSON.stringify({
          type: "error",
          error:
            "Invalid message payload. Send JSON with phoneNumber and text.",
        }),
      );
      return;
    }

    const deps = createDependencies(this.env);
    const publish = (sessionId: string, event: AgentEvent) => {
      if (!this.env.CONVERSATION_HUB) {
        return;
      }
      const id = this.env.CONVERSATION_HUB.idFromName(sessionId);
      const stub = this.env.CONVERSATION_HUB.get(id);
      void stub.fetch("https://conversation-hub/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });
    };
    await emitReply(
      (event) => {
        connection.send(JSON.stringify(event));
      },
      deps,
      validation.data,
      (response) => {
        this.setState({
          lastCallSessionId: response.callSessionId,
          lastPhoneNumber: validation.data.phoneNumber,
        });
      },
      undefined,
      publish,
    );
  }
}

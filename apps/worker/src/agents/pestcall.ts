import { Agent, type StreamingResponse, callable } from "agents";

import { createDependencies } from "../context";
import type { Env } from "../env";
import {
  type AgentMessageInput,
  agentMessageInputSchema,
} from "../schemas/agent";
import { handleAgentMessage } from "../use-cases/agent";

type AgentState = {
  lastCallSessionId?: string;
  lastPhoneNumber?: string;
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

export class PestCallAgent extends Agent<Env, AgentState> {
  override initialState: AgentState = {};

  @callable()
  async message(input: AgentMessageInput) {
    const deps = createDependencies(this.env);
    deps.logger.info(
      {
        callSessionId: input.callSessionId ?? "new",
        build: this.env.BUILD_ID ?? null,
      },
      "agent.stream.start",
    );
    const response = await handleAgentMessage(deps, input);
    this.setState({
      lastCallSessionId: response.callSessionId,
      lastPhoneNumber: input.phoneNumber,
    });
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
    const response = await handleAgentMessage(deps, input, undefined, {
      onStatus: (status) => {
        deps.logger.debug(
          {
            callSessionId: input.callSessionId ?? response.callSessionId,
            statusText: status.text,
          },
          "agent.stream.status",
        );
        stream.send({ type: "status", text: status.text });
      },
    });
    this.setState({
      lastCallSessionId: response.callSessionId,
      lastPhoneNumber: input.phoneNumber,
    });

    const chunks = response.replyText.split(/(\s+)/).filter(Boolean);
    for (const chunk of chunks) {
      stream.send({ type: "delta", text: chunk });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    deps.logger.info(
      {
        callSessionId: response.callSessionId,
        replyTextLength: response.replyText.length,
        build: this.env.BUILD_ID ?? null,
      },
      "agent.stream.final",
    );
    stream.end({ type: "final", data: response });
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
          } catch {
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
    const response = await handleAgentMessage(deps, validation.data);
    this.setState({
      lastCallSessionId: response.callSessionId,
      lastPhoneNumber: validation.data.phoneNumber,
    });
    connection.send(JSON.stringify({ type: "reply", data: response }));
  }
}

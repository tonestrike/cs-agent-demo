import { Agent, callable } from "agents";

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
    const response = await handleAgentMessage(deps, input);
    this.setState({
      lastCallSessionId: response.callSessionId,
      lastPhoneNumber: input.phoneNumber,
    });
    return response;
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

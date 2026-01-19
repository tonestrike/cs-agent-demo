/**
 * Turn recording and retrieval functions
 */

import { normalizePhoneE164 } from "@pestcall/core";
import type {
  CallsRepository,
  MessagesContext,
  ModelMessage,
  TurnInput,
} from "./types";

/**
 * Ensure a call session exists, creating it if needed.
 */
export async function ensureCallSession(
  calls: CallsRepository,
  callSessionId: string,
  phoneNumber: string,
): Promise<void> {
  const existing = await calls.getSession(callSessionId);
  if (existing) {
    return;
  }
  const nowIso = new Date().toISOString();
  const phoneE164 = normalizePhoneE164(phoneNumber);
  await calls.createSession({
    id: callSessionId,
    startedAt: nowIso,
    phoneE164,
    status: "active",
    transport: "web",
    summary: null,
  });
}

/**
 * Record user and agent turns to the database.
 */
export async function recordTurns(
  ctx: MessagesContext,
  input: TurnInput,
): Promise<void> {
  const { callSessionId, phoneNumber, userText, agentText, turnId, meta } =
    input;

  if (!callSessionId) {
    return;
  }

  await ensureCallSession(ctx.calls, callSessionId, phoneNumber);

  const nowIso = new Date().toISOString();
  const trimmedUser = userText.trim();
  const trimmedAgent = agentText.trim();

  if (trimmedUser) {
    await ctx.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: nowIso,
      speaker: "customer",
      text: trimmedUser,
      meta: { turnId },
    });
  }

  if (trimmedAgent) {
    await ctx.calls.addTurn({
      id: crypto.randomUUID(),
      callSessionId,
      ts: nowIso,
      speaker: "agent",
      text: trimmedAgent,
      meta: meta ?? {},
    });
  }
}

/**
 * Get recent messages in model format.
 *
 * Filters out status messages to avoid "already answered" bias
 * in the tool model.
 */
export async function getRecentMessages(
  ctx: MessagesContext,
  callSessionId: string,
  limit = 10,
): Promise<ModelMessage[]> {
  const start = Date.now();
  const turns = await ctx.calls.getRecentTurns({ callSessionId, limit });

  const messages = turns
    .filter((turn) => {
      // Include customer and agent messages, drop status messages
      const kind = (turn.meta as { kind?: string } | undefined)?.kind;
      const isStatus = kind === "status";
      return (
        (turn.speaker === "customer" || turn.speaker === "agent") && !isStatus
      );
    })
    .map((turn): ModelMessage => {
      const role = turn.speaker === "customer" ? "user" : "assistant";
      return { role, content: turn.text };
    })
    .filter((msg) => msg.content.trim().length > 0);

  ctx.logger.info(
    `conversation.session.messages.recent (${Date.now() - start}ms, ${messages.length} messages)`,
  );

  return messages;
}

/**
 * Record a status message (system turn).
 */
export async function recordStatusTurn(
  ctx: MessagesContext,
  callSessionId: string,
  phoneNumber: string,
  text: string,
  correlationId?: string,
): Promise<void> {
  await ensureCallSession(ctx.calls, callSessionId, phoneNumber);

  await ctx.calls.addTurn({
    id: crypto.randomUUID(),
    callSessionId,
    ts: new Date().toISOString(),
    speaker: "system",
    text,
    meta: {
      kind: "status",
      correlationId: correlationId ?? null,
    },
  });
}

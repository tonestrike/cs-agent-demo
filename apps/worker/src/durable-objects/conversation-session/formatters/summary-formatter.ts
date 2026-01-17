/**
 * Pure functions for formatting conversation summaries
 */

import type { SessionData, TurnData } from "../types";

/**
 * Format a conversation summary in markdown format
 */
export function formatConversationSummary(
  session: SessionData,
  turns: TurnData[],
): string {
  const lines: string[] = [];
  lines.push(`# Conversation ${session.id}`);
  lines.push("");
  lines.push("## Session");
  lines.push(`- Phone: ${session.phoneE164}`);
  lines.push(`- Status: ${session.status}`);
  lines.push(`- Transport: ${session.transport}`);
  lines.push(`- Started: ${session.startedAt}`);
  lines.push(`- Ended: ${session.endedAt ?? "in progress"}`);
  if (session.customer) {
    lines.push(
      `- Customer: ${session.customer.displayName} (${session.customer.phoneE164})`,
    );
    if (session.customer.addressSummary) {
      lines.push(`- Address: ${session.customer.addressSummary}`);
    }
    if (session.customer.zipCode) {
      lines.push(`- ZIP: ${session.customer.zipCode}`);
    }
  }
  if (session.callSummary) {
    lines.push("");
    lines.push("## Call summary");
    lines.push(session.callSummary);
  }
  if (session.summary) {
    lines.push("");
    lines.push("## Raw session summary");
    lines.push("```json");
    lines.push(session.summary);
    lines.push("```");
  }
  lines.push("");
  lines.push("## Turns");
  turns.forEach((turn, index) => {
    const role =
      turn.speaker === "system" ||
      (turn.meta as { kind?: string } | undefined)?.kind === "status"
        ? "System"
        : turn.speaker === "agent"
          ? "Assistant"
          : "Customer";
    lines.push("");
    lines.push(`### Turn ${index + 1} (${role})`);
    lines.push(`- Time: ${turn.ts}`);
    lines.push(`- Text: ${turn.text}`);
    if (turn.meta && Object.keys(turn.meta).length > 0) {
      lines.push("");
      lines.push("#### Meta");
      lines.push("```json");
      lines.push(JSON.stringify(turn.meta, null, 2));
      lines.push("```");
    }
  });
  return lines.join("\n");
}

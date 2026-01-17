/**
 * Handler for crm.escalate and agent.escalate tools
 *
 * Both tools have the same args schema, so we use a union type.
 */

import type {
  ToolExecutionInput,
  ToolFlowContext,
  ToolRawResult,
} from "../types";

type EscalateInput =
  | ToolExecutionInput<"crm.escalate">
  | ToolExecutionInput<"agent.escalate">;

export async function handleEscalate(
  ctx: ToolFlowContext,
  { args, input }: EscalateInput,
): Promise<ToolRawResult> {
  const summary = args.summary ?? args.message ?? input.text;

  const result = await ctx.deps.crm.escalate({
    reason: args.reason ?? "customer_request",
    summary,
    customerId:
      ctx.sessionState.conversation?.verification.customerId ?? undefined,
  });

  if (!result.ok) {
    return {
      toolName: "crm.escalate",
      result: { ok: false, error: "escalation_failed" },
      fallback:
        "I'm sorry, I couldn't start an escalation right now. Please try again in a moment.",
      contextHint: "Apologize and ask them to try again shortly.",
    };
  }

  return {
    toolName: "crm.escalate",
    result: { ok: true, ticketId: result.ticketId },
    fallback: `I've asked a specialist to reach out. Your ticket ID is ${result.ticketId ?? "on file"}.`,
    contextHint:
      "Confirm that a specialist will follow up and share the ticket id if available.",
  };
}

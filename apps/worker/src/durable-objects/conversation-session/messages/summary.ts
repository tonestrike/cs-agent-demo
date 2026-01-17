/**
 * Session summary update functions
 */

import type { MessagesContext, SummarySnapshot } from "./types";
import { ensureCallSession } from "./turns";

/**
 * Parse a session summary from JSON string.
 */
function parseSummary(
  summaryJson: string | null | undefined,
  logger: MessagesContext["logger"],
): SummarySnapshot {
  if (!summaryJson) {
    return {};
  }
  try {
    return JSON.parse(summaryJson) as SummarySnapshot;
  } catch {
    logger.error("conversation.session.summary.parse_failed");
    return {};
  }
}

/**
 * Update the identity verification status in session summary.
 */
export async function updateIdentitySummary(
  ctx: MessagesContext,
  callSessionId: string,
  phoneNumber: string,
  customerId: string,
): Promise<void> {
  await ensureCallSession(ctx.calls, callSessionId, phoneNumber);

  const session = await ctx.calls.getSession(callSessionId);
  const summary = parseSummary(session?.summary, ctx.logger);

  const nextSummary: SummarySnapshot = {
    ...summary,
    identityStatus: "verified",
    verifiedCustomerId: customerId,
  };

  await ctx.calls.updateSessionSummary({
    callSessionId,
    summary: JSON.stringify(nextSummary),
  });
}

/**
 * Update the appointment options in session summary.
 */
export async function updateAppointmentSummary(
  ctx: MessagesContext,
  callSessionId: string,
  phoneNumber: string,
  appointments: Array<{
    id: string;
    date: string;
    timeWindow: string;
    addressSummary: string;
  }>,
): Promise<void> {
  await ensureCallSession(ctx.calls, callSessionId, phoneNumber);

  const session = await ctx.calls.getSession(callSessionId);
  const summary = parseSummary(session?.summary, ctx.logger);

  const nextSummary: SummarySnapshot = {
    ...summary,
    lastAppointmentOptions: appointments.map((appt) => ({
      id: appt.id,
      date: appt.date,
      timeWindow: appt.timeWindow,
      addressSummary: appt.addressSummary,
    })),
  };

  await ctx.calls.updateSessionSummary({
    callSessionId,
    summary: JSON.stringify(nextSummary),
  });
}

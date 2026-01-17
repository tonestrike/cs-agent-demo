import type { SessionState } from "./types";

export const detectActionIntent = (
  text: string,
): SessionState["pendingIntent"] | null => {
  const lower = (text || "").toLowerCase();
  if (lower.includes("resched")) {
    return { kind: "reschedule", text };
  }
  if (lower.includes("cancel")) {
    return { kind: "cancel", text };
  }
  if (lower.includes("schedule") || lower.includes("book")) {
    return { kind: "schedule", text };
  }
  if (lower.includes("appointment")) {
    return { kind: "appointments", text };
  }
  return null;
};

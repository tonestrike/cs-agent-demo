import { describe, expect, it } from "vitest";

import { applyStatusTransition, createTicket } from "./index";

const baseTicket = createTicket({
  id: "ticket-1",
  createdAt: "2025-01-15T00:00:00Z",
  subject: "Pest inspection",
  description: "Customer asked about next appointment.",
  source: "agent",
});

describe("ticket status transitions", () => {
  it("moves from open to in_progress to resolved", () => {
    const first = applyStatusTransition(
      baseTicket,
      "in_progress",
      "2025-01-15T01:00:00Z",
    );
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    const second = applyStatusTransition(
      first.ticket,
      "resolved",
      "2025-01-15T02:00:00Z",
    );
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }

    expect(second.ticket.status).toBe("resolved");
    expect(second.ticket.updatedAt).toBe("2025-01-15T02:00:00Z");
  });

  it("rejects invalid transitions", () => {
    const resolvedTicket = {
      ...baseTicket,
      status: "resolved" as const,
    };

    const result = applyStatusTransition(
      resolvedTicket,
      "in_progress",
      "2025-01-15T03:00:00Z",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch("Invalid status transition");
    }
  });
});

import { describe, expect, it } from "vitest";

import { applyIntent, initialConversationState } from "./state-machine";

describe("conversation state machine", () => {
  it("moves to verified idle on verification", () => {
    const initial = initialConversationState();
    const next = applyIntent(initial, {
      type: "verified",
      customerId: "cust_001",
    });
    expect(next.status).toBe("VerifiedIdle");
    expect(next.verification.verified).toBe(true);
    expect(next.verification.customerId).toBe("cust_001");
    expect(next.verification.zipAttempts).toBe(0);
  });

  it("tracks invalid zip attempts", () => {
    const initial = initialConversationState();
    const next = applyIntent(initial, {
      type: "request_verification",
      reason: "invalid_zip",
    });
    expect(next.verification.zipAttempts).toBe(1);
    expect(next.status).toBe("CollectingVerification");
  });

  it("stores appointments when loaded", () => {
    const initial = initialConversationState();
    const next = applyIntent(initial, {
      type: "appointments_loaded",
      appointments: [
        {
          id: "appt_001",
          date: "2025-02-10",
          timeWindow: "10:00-12:00",
          addressSummary: "742 Evergreen Terrace",
        },
      ],
    });
    expect(next.status).toBe("PresentingAppointments");
    expect(next.appointments.length).toBe(1);
    expect(next.appointments[0]?.id).toBe("appt_001");
  });

  it("tracks cancellation confirmation flow", () => {
    const initial = initialConversationState();
    const pending = applyIntent(initial, {
      type: "cancel_requested",
      appointmentId: "appt_001",
    });
    expect(pending.status).toBe("PendingCancellationConfirmation");
    expect(pending.pendingCancellationId).toBe("appt_001");

    const confirmed = applyIntent(pending, { type: "cancel_confirmed" });
    expect(confirmed.status).toBe("Completed");
    expect(confirmed.pendingCancellationId).toBeNull();

    const declined = applyIntent(pending, { type: "cancel_declined" });
    expect(declined.status).toBe("VerifiedIdle");
    expect(declined.pendingCancellationId).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { initialConversationState } from "./state-machine";
import { deriveConversationStateFromSummary } from "./summary-state";

describe("deriveConversationStateFromSummary", () => {
  it("maps verified summary to verified state", () => {
    const next = deriveConversationStateFromSummary(
      initialConversationState(),
      {
        identityStatus: "verified",
        verifiedCustomerId: "cust_123",
      },
    );
    expect(next.status).toBe("VerifiedIdle");
    expect(next.verification.verified).toBe(true);
    expect(next.verification.customerId).toBe("cust_123");
  });

  it("maps cancel workflow confirm to pending cancellation", () => {
    const next = deriveConversationStateFromSummary(
      initialConversationState(),
      {
        identityStatus: "verified",
        verifiedCustomerId: "cust_123",
        workflowState: {
          kind: "cancel",
          step: "confirm",
          appointmentId: "appt_001",
        },
      },
    );
    expect(next.status).toBe("PendingCancellationConfirmation");
    expect(next.pendingCancellationId).toBe("appt_001");
  });
});

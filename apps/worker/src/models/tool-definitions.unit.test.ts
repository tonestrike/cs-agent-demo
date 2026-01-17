import { describe, expect, it } from "vitest";

import { getAvailableToolNames, validateToolArgs } from "./tool-definitions";

describe("tool-definitions", () => {
  it("keeps agent.escalate gated until the customer is verified", () => {
    const unverified = getAvailableToolNames({
      isVerified: false,
      hasActiveWorkflow: false,
    });

    expect(unverified).not.toContain("agent.escalate");

    const verified = getAvailableToolNames({
      isVerified: true,
      hasActiveWorkflow: false,
    });

    expect(verified).toContain("agent.escalate");
  });

  it("accepts ZIP codes with leading zeros exactly as provided", () => {
    const result = validateToolArgs("crm.verifyAccount", {
      zipCode: "00000",
    });

    expect(result.ok).toBe(true);
    expect(result.data.zipCode).toBe("00000");
  });
});

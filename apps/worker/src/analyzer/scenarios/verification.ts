import type { ScenarioDefinition } from "../types";

/**
 * Verification flow scenarios
 *
 * These scenarios test the customer verification workflow.
 */

export const verificationScenarios: ScenarioDefinition[] = [
  {
    id: "verification-happy-path",
    name: "Verification Happy Path",
    description:
      "Customer calls, provides correct ZIP code, and is successfully verified.",
    category: "verification",
    setup: {
      phone: "+14155552671",
      zip: "94107",
    },
    steps: [
      {
        userMessage: "Hello",
        expectations: {
          responsePatterns: [
            "(hi|hello|welcome|thanks for calling|happy to help)",
            "zip",
          ],
          responseExcludes: ["crm\\.", "tool", "lookup"],
        },
      },
      {
        userMessage: "94107",
        expectations: {
          toolCalls: [{ name: "crm.verifyAccount" }],
          stateChanges: {
            "conversation.verification.verified": true,
          },
          responsePatterns: ["(verified|confirmed|found)"],
          responseExcludes: ["sorry", "couldn't", "crm\\."],
        },
      },
    ],
    successCriteria: {
      finalState: {
        "conversation.verification.verified": true,
      },
      minPassingSteps: 2,
    },
  },

  {
    id: "verification-wrong-zip",
    name: "Verification Wrong ZIP",
    description: "Customer provides incorrect ZIP code and is not verified.",
    category: "verification",
    setup: {
      phone: "+14155552671",
      zip: "94107",
    },
    steps: [
      {
        userMessage: "Hi there",
        expectations: {
          responsePatterns: ["zip"],
          responseExcludes: ["crm\\."],
        },
      },
      {
        userMessage: "12345",
        expectations: {
          toolCalls: [{ name: "crm.verifyAccount" }],
          responsePatterns: [
            "(didn't match|couldn't verify|try again|incorrect)",
          ],
          responseExcludes: ["verified", "confirmed", "crm\\."],
        },
      },
    ],
    successCriteria: {
      minPassingSteps: 1,
    },
  },

  {
    id: "verification-zip-with-leading-zero",
    name: "Verification ZIP with Leading Zero",
    description:
      "Customer provides ZIP code with leading zero (should be preserved).",
    category: "verification",
    setup: {
      phone: "+14155550101",
      zip: "02101", // Boston ZIP with leading zero
      customerId: "cust_boston",
    },
    steps: [
      {
        userMessage: "Hello",
        expectations: {
          responsePatterns: ["zip"],
        },
      },
      {
        userMessage: "02101",
        expectations: {
          toolCalls: [
            {
              name: "crm.verifyAccount",
              argsContain: { zipCode: "02101" }, // Leading zero preserved
            },
          ],
        },
      },
    ],
    successCriteria: {
      minPassingSteps: 1,
    },
  },

  {
    id: "verification-no-redundant-ask",
    name: "No Redundant Verification",
    description: "After verification, bot should not ask for ZIP again.",
    category: "verification",
    setup: {
      phone: "+14155552671",
      zip: "94107",
    },
    steps: [
      {
        userMessage: "Hello",
        expectations: {
          responsePatterns: ["zip"],
        },
      },
      {
        userMessage: "94107",
        expectations: {
          stateChanges: {
            "conversation.verification.verified": true,
          },
        },
      },
      {
        userMessage: "What appointments do I have?",
        expectations: {
          // Should NOT ask for ZIP again
          responseExcludes: ["zip code", "verify"],
          toolCalls: [{ name: "crm.listUpcomingAppointments" }],
        },
      },
    ],
    successCriteria: {
      finalState: {
        "conversation.verification.verified": true,
      },
      minPassingSteps: 2,
    },
  },

  {
    id: "verification-natural-conversation",
    name: "Natural Verification Flow",
    description: "Verification should feel natural, not robotic.",
    category: "verification",
    setup: {
      phone: "+14155552671",
      zip: "94107",
    },
    steps: [
      {
        userMessage: "Hey, I need help with my appointment",
        expectations: {
          // Should acknowledge the request naturally and ask for ZIP
          responsePatterns: ["(help|appointment|sure|happy)", "zip"],
          // Should NOT sound robotic
          responseExcludes: [
            "to get started",
            "I understand that",
            "verification succeeded",
          ],
        },
      },
      {
        userMessage: "94107",
        expectations: {
          // Confirmation should be natural
          responseExcludes: [
            "verification succeeded",
            "identity confirmed",
            "crm\\.",
          ],
        },
      },
    ],
    successCriteria: {
      minPassingSteps: 1,
    },
  },
];

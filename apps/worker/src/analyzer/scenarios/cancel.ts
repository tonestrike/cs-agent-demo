import type { ScenarioDefinition } from "../types";

/**
 * Cancel flow scenarios
 *
 * These scenarios test the appointment cancellation workflow.
 */

export const cancelScenarios: ScenarioDefinition[] = [
  {
    id: "cancel-happy-path",
    name: "Cancel Happy Path",
    description:
      "Customer verifies, requests cancellation, selects appointment, and confirms.",
    category: "cancel",
    setup: {
      phone: "+14155551234",
      zip: "60601",
      seedAppointment: true,
      customerId: "cust_cancel_001",
      appointmentId: "appt_cancel_001",
    },
    steps: [
      {
        userMessage: "I need to cancel my appointment",
        expectations: {
          responsePatterns: ["zip", "(verify|confirm)"],
          responseExcludes: ["crm\\."],
        },
      },
      {
        userMessage: "60601",
        expectations: {
          toolCalls: [{ name: "crm.verifyAccount" }],
          stateChanges: {
            "conversation.verification.verified": true,
          },
          responsePatterns: ["(verified|found|appointment)"],
        },
      },
      {
        userMessage: "Yes, please cancel it",
        expectations: {
          toolCalls: [{ name: "crm.listUpcomingAppointments" }],
          responsePatterns: ["(appointment|cancel|which)"],
          responseExcludes: ["crm\\.", "tool"],
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
    id: "cancel-requires-confirmation",
    name: "Cancel Requires Confirmation",
    description: "Bot should confirm cancellation before executing.",
    category: "cancel",
    setup: {
      phone: "+14155551234",
      zip: "60601",
      seedAppointment: true,
      customerId: "cust_cancel_002",
      appointmentId: "appt_cancel_002",
    },
    steps: [
      {
        userMessage: "Cancel my appointment",
        expectations: {
          responsePatterns: ["zip"],
        },
      },
      {
        userMessage: "60601",
        expectations: {
          toolCalls: [{ name: "crm.verifyAccount" }],
        },
      },
      {
        userMessage: "I want to cancel",
        expectations: {
          toolCalls: [{ name: "crm.listUpcomingAppointments" }],
          // Should list appointments, not immediately cancel
          responsePatterns: ["(which|appointment|scheduled)"],
          // Should NOT immediately cancel without confirmation
          responseExcludes: ["cancelled", "has been cancelled"],
        },
      },
    ],
    successCriteria: {
      minPassingSteps: 2,
    },
  },

  {
    id: "cancel-no-appointments",
    name: "Cancel No Appointments",
    description: "Customer tries to cancel but has no upcoming appointments.",
    category: "cancel",
    setup: {
      phone: "+14155558888",
      zip: "33101",
      seedAppointment: false,
      customerId: "cust_no_cancel",
    },
    steps: [
      {
        userMessage: "I want to cancel my appointment",
        expectations: {
          responsePatterns: ["zip"],
        },
      },
      {
        userMessage: "33101",
        expectations: {
          toolCalls: [{ name: "crm.verifyAccount" }],
        },
      },
      {
        userMessage: "Yes, cancel it",
        expectations: {
          toolCalls: [{ name: "crm.listUpcomingAppointments" }],
          // Should gracefully handle no appointments
          responsePatterns: [
            "(no|don't have|couldn't find|any).*(appointment)",
          ],
        },
      },
    ],
    successCriteria: {
      minPassingSteps: 2,
    },
  },

  {
    id: "cancel-verified-already",
    name: "Cancel After Verification",
    description:
      "Customer already verified, then requests cancel without re-verification.",
    category: "cancel",
    setup: {
      phone: "+14155551234",
      zip: "60601",
      seedAppointment: true,
      customerId: "cust_cancel_003",
      appointmentId: "appt_cancel_003",
    },
    steps: [
      {
        userMessage: "Hello there",
        expectations: {
          responsePatterns: ["zip"],
        },
      },
      {
        userMessage: "60601",
        expectations: {
          toolCalls: [{ name: "crm.verifyAccount" }],
          stateChanges: {
            "conversation.verification.verified": true,
          },
        },
      },
      {
        userMessage: "Actually, I need to cancel my service appointment",
        expectations: {
          // Should NOT ask for ZIP again
          responseExcludes: ["zip code", "verify your"],
          // Should look up appointments
          toolCalls: [{ name: "crm.listUpcomingAppointments" }],
        },
      },
    ],
    successCriteria: {
      minPassingSteps: 2,
    },
  },

  {
    id: "cancel-natural-phrasing",
    name: "Cancel Natural Language",
    description: "Cancel request in various natural phrasings.",
    category: "cancel",
    setup: {
      phone: "+14155551234",
      zip: "60601",
      seedAppointment: true,
      customerId: "cust_cancel_004",
      appointmentId: "appt_cancel_004",
    },
    steps: [
      {
        userMessage: "Hey",
        expectations: {
          responsePatterns: ["(hello|hi|hey)"],
        },
      },
      {
        userMessage: "60601",
        expectations: {
          toolCalls: [{ name: "crm.verifyAccount" }],
        },
      },
      {
        userMessage:
          "I won't be needing that service anymore, can you take it off my schedule?",
        expectations: {
          // Should understand this is a cancel request
          toolCalls: [{ name: "crm.listUpcomingAppointments" }],
          // Should acknowledge naturally
          responsePatterns: ["(sure|of course|no problem|help)"],
          responseExcludes: ["I understand that"],
        },
      },
    ],
    successCriteria: {
      minPassingSteps: 2,
    },
  },

  {
    id: "cancel-with-impact-info",
    name: "Cancel Shows Impact",
    description: "When cancelling, bot should explain any relevant impact.",
    category: "cancel",
    setup: {
      phone: "+14155551234",
      zip: "60601",
      seedAppointment: true,
      customerId: "cust_cancel_005",
      appointmentId: "appt_cancel_005",
    },
    steps: [
      {
        userMessage: "Cancel please",
        expectations: {
          responsePatterns: ["zip"],
        },
      },
      {
        userMessage: "60601",
        expectations: {
          toolCalls: [{ name: "crm.verifyAccount" }],
        },
      },
      {
        userMessage: "Cancel my appointment",
        expectations: {
          toolCalls: [{ name: "crm.listUpcomingAppointments" }],
          // Should present clear information
          responsePatterns: ["(appointment|scheduled|date|time)"],
        },
      },
    ],
    successCriteria: {
      minPassingSteps: 2,
    },
  },
];

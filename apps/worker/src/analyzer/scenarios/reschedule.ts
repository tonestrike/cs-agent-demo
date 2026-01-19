import type { ScenarioDefinition } from "../types";

/**
 * Reschedule flow scenarios
 *
 * These scenarios test the appointment rescheduling workflow.
 */

export const rescheduleScenarios: ScenarioDefinition[] = [
  {
    id: "reschedule-happy-path",
    name: "Reschedule Happy Path",
    description:
      "Customer verifies, requests reschedule, selects appointment, and confirms new time.",
    category: "reschedule",
    setup: {
      phone: "+14155550987",
      zip: "98109",
      seedAppointment: true,
      customerId: "cust_resched_001",
      appointmentId: "appt_resched_001",
    },
    steps: [
      {
        userMessage: "Hi, I need to reschedule my appointment",
        expectations: {
          responsePatterns: ["zip", "(verify|confirm)"],
          responseExcludes: ["crm\\."],
        },
      },
      {
        userMessage: "98109",
        expectations: {
          toolCalls: [{ name: "crm.verifyAccount" }],
          stateChanges: {
            "conversation.verification.verified": true,
          },
          responsePatterns: ["(verified|found|appointment)"],
        },
      },
      {
        userMessage: "I want to reschedule my upcoming appointment",
        expectations: {
          toolCalls: [{ name: "crm.listUpcomingAppointments" }],
          responsePatterns: ["(appointment|scheduled|when)"],
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
    id: "reschedule-verified-first",
    name: "Reschedule After Verification",
    description:
      "Customer already verified, then requests reschedule without re-verification.",
    category: "reschedule",
    setup: {
      phone: "+14155550987",
      zip: "98109",
      seedAppointment: true,
      customerId: "cust_resched_002",
      appointmentId: "appt_resched_002",
    },
    steps: [
      {
        userMessage: "Hello",
        expectations: {
          responsePatterns: ["zip"],
        },
      },
      {
        userMessage: "98109",
        expectations: {
          toolCalls: [{ name: "crm.verifyAccount" }],
          stateChanges: {
            "conversation.verification.verified": true,
          },
        },
      },
      {
        userMessage: "I need to change my appointment to a different day",
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
    id: "reschedule-no-appointments",
    name: "Reschedule No Appointments",
    description:
      "Customer tries to reschedule but has no upcoming appointments.",
    category: "reschedule",
    setup: {
      phone: "+14155559999",
      zip: "90210",
      seedAppointment: false,
      customerId: "cust_no_appt",
    },
    steps: [
      {
        userMessage: "I want to reschedule",
        expectations: {
          responsePatterns: ["zip"],
        },
      },
      {
        userMessage: "90210",
        expectations: {
          toolCalls: [{ name: "crm.verifyAccount" }],
        },
      },
      {
        userMessage: "Yes, reschedule my appointment please",
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
    id: "reschedule-clear-confirmation",
    name: "Reschedule Clear Confirmation",
    description:
      "Bot should clearly confirm reschedule details before executing.",
    category: "reschedule",
    setup: {
      phone: "+14155550987",
      zip: "98109",
      seedAppointment: true,
      customerId: "cust_resched_003",
      appointmentId: "appt_resched_003",
    },
    steps: [
      {
        userMessage: "Hello, reschedule please",
        expectations: {
          responsePatterns: ["zip"],
        },
      },
      {
        userMessage: "98109",
        expectations: {
          toolCalls: [{ name: "crm.verifyAccount" }],
        },
      },
      {
        userMessage: "Reschedule my appointment",
        expectations: {
          toolCalls: [{ name: "crm.listUpcomingAppointments" }],
          // Should present appointments clearly
          responsePatterns: ["(appointment|scheduled|date)"],
        },
      },
    ],
    successCriteria: {
      minPassingSteps: 2,
    },
  },

  {
    id: "reschedule-natural-flow",
    name: "Reschedule Natural Language",
    description: "Reschedule request in various natural phrasings.",
    category: "reschedule",
    setup: {
      phone: "+14155550987",
      zip: "98109",
      seedAppointment: true,
      customerId: "cust_resched_004",
      appointmentId: "appt_resched_004",
    },
    steps: [
      {
        userMessage: "Hi",
        expectations: {
          responsePatterns: ["(hello|hi|welcome)"],
        },
      },
      {
        userMessage: "98109",
        expectations: {
          toolCalls: [{ name: "crm.verifyAccount" }],
        },
      },
      {
        userMessage:
          "Something came up and I can't make my appointment anymore. Can we move it?",
        expectations: {
          // Should understand this is a reschedule request
          toolCalls: [{ name: "crm.listUpcomingAppointments" }],
          // Should acknowledge the situation naturally
          responsePatterns: ["(understand|no problem|sure|of course|help)"],
          responseExcludes: ["I understand that you"],
        },
      },
    ],
    successCriteria: {
      minPassingSteps: 2,
    },
  },
];

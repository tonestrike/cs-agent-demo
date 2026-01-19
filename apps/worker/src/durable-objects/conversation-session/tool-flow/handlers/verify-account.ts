/**
 * Account verification tool handler
 *
 * Handles crm.verifyAccount - verifies a customer using their ZIP code.
 * Uses the phone number from the call context to look up the customer,
 * then verifies against the provided ZIP.
 */

import {
  lookupCustomerByPhone,
  verifyAccount,
} from "../../../../use-cases/crm";
import { processPendingIntent } from "../../intent";
import type {
  ToolExecutionInput,
  ToolFlowContext,
  ToolRawResult,
} from "../types";

/**
 * Verify customer account with ZIP code.
 *
 * Flow:
 * 1. Get phone number from context (call session)
 * 2. Look up customer(s) by phone
 * 3. Try to verify each with the ZIP
 * 4. Update verification state if successful
 * 5. Process any pending intent (reschedule, cancel, etc.)
 */
export async function handleVerifyAccount(
  ctx: ToolFlowContext,
  { args }: ToolExecutionInput<"crm.verifyAccount">,
): Promise<ToolRawResult> {
  const { zipCode } = args;
  const phoneNumber = ctx.sessionState.lastPhoneNumber;

  ctx.logger.info(
    { zipCode, phoneNumber, argsRaw: JSON.stringify(args) },
    "tool.verify_account.start",
  );

  // No phone number available
  if (!phoneNumber) {
    const currentAttempts =
      ctx.getConversationState().verification?.zipAttempts ?? 0;

    return {
      toolName: "crm.verifyAccount",
      result: {
        verified: false,
        error: "no_phone",
        message: "No phone number available for verification.",
      },
      fallback:
        "I'm having trouble verifying your account. Could you provide your phone number?",
      contextHint:
        "No phone number available in session. Ask customer for their phone number.",
      stateUpdates: {
        conversation: {
          ...ctx.getConversationState(),
          verification: {
            ...ctx.getConversationState().verification,
            verified: false,
            zipAttempts: currentAttempts + 1,
          },
        },
      },
    };
  }

  // Look up customer by phone
  let customers: Awaited<ReturnType<typeof lookupCustomerByPhone>> = [];
  try {
    customers = await lookupCustomerByPhone(ctx.deps.crm, phoneNumber);
    ctx.logger.info(
      {
        phoneNumber,
        customerCount: customers.length,
        customers: customers.map((c) => ({
          id: c.id,
          displayName: c.displayName,
          zipCode: c.zipCode,
        })),
      },
      "tool.verify_account.lookup_complete",
    );
  } catch (error) {
    ctx.logger.error(
      { error: error instanceof Error ? error.message : "unknown" },
      "tool.verify_account.lookup_failed",
    );
    return {
      toolName: "crm.verifyAccount",
      result: {
        verified: false,
        error: "lookup_failed",
        message: "Could not look up account. Please try again.",
      },
      fallback:
        "I'm having trouble looking up your account right now. Can you try again in a moment?",
      contextHint:
        "Customer lookup failed due to a system error. Apologize and offer to try again.",
    };
  }

  // No customers found for this phone
  if (customers.length === 0) {
    const currentAttempts =
      ctx.getConversationState().verification?.zipAttempts ?? 0;

    return {
      toolName: "crm.verifyAccount",
      result: {
        verified: false,
        error: "no_customer",
        message: "No account found for this phone number.",
      },
      fallback:
        "I couldn't find an account associated with this phone number. Would you like me to connect you with a specialist?",
      contextHint:
        "No customer account found for caller's phone number. Offer to escalate to a human.",
      stateUpdates: {
        conversation: {
          ...ctx.getConversationState(),
          verification: {
            ...ctx.getConversationState().verification,
            verified: false,
            zipAttempts: currentAttempts + 1,
          },
        },
      },
    };
  }

  // Try to verify each customer with the ZIP
  for (const customer of customers) {
    ctx.logger.info(
      {
        customerId: customer.id,
        customerZip: customer.zipCode,
        providedZip: zipCode,
        wouldMatch: customer.zipCode === zipCode,
      },
      "tool.verify_account.checking_customer",
    );
    try {
      const verified = await verifyAccount(ctx.deps.crm, customer.id, zipCode);
      ctx.logger.info(
        { customerId: customer.id, verified },
        "tool.verify_account.verify_result",
      );
      if (verified) {
        ctx.logger.info(
          { customerId: customer.id },
          "tool.verify_account.verified",
        );

        // Check for and process pending intent (reschedule, cancel, appointments, etc.)
        const pendingIntent = ctx.sessionState.pendingIntent;
        if (pendingIntent) {
          ctx.logger.info(
            { customerId: customer.id, intent: pendingIntent.kind },
            "tool.verify_account.processing_pending_intent",
          );

          try {
            const intentResult = await processPendingIntent(pendingIntent, {
              crm: ctx.deps.crm,
              customerId: customer.id,
              customerName: customer.displayName,
              getConversationState: ctx.getConversationState,
            });

            if (intentResult) {
              return intentResult;
            }
          } catch (error) {
            ctx.logger.error(
              { error: error instanceof Error ? error.message : "unknown" },
              "tool.verify_account.intent_processing_failed",
            );
            // Fall through to default verification success
          }
        }

        // Default success - no pending intent or unsupported intent
        return {
          toolName: "crm.verifyAccount",
          result: {
            verified: true,
            customerId: customer.id,
            customerName: customer.displayName,
            message: "Account verified successfully.",
          },
          fallback: `Thank you! I've verified your account, ${customer.displayName}. How can I help you today?`,
          contextHint:
            "Account verified successfully. Greet customer by name and ask how you can help.",
          stateUpdates: {
            conversation: {
              ...ctx.getConversationState(),
              status: "VerifiedIdle",
              verification: {
                verified: true,
                customerId: customer.id,
                zipAttempts: 0,
              },
            },
          },
        };
      }
    } catch (error) {
      ctx.logger.warn(
        {
          customerId: customer.id,
          error: error instanceof Error ? error.message : "unknown",
        },
        "tool.verify_account.verify_error",
      );
      // Continue trying other customers
    }
  }

  // No customer matched the ZIP
  const currentAttempts =
    ctx.getConversationState().verification?.zipAttempts ?? 0;
  const newAttempts = currentAttempts + 1;

  ctx.logger.info(
    { attempts: newAttempts },
    "tool.verify_account.zip_mismatch",
  );

  // After 2 failed attempts, offer escalation
  const shouldOfferEscalation = newAttempts >= 2;

  return {
    toolName: "crm.verifyAccount",
    result: {
      verified: false,
      error: "zip_mismatch",
      attempts: newAttempts,
      message: shouldOfferEscalation
        ? "ZIP code doesn't match. Would you like me to connect you with a specialist?"
        : "That ZIP code doesn't match our records. Can you try again?",
    },
    fallback: shouldOfferEscalation
      ? "That ZIP code doesn't match what we have on file. Would you like me to connect you with a specialist who can help verify your account?"
      : "Hmm, that ZIP code doesn't match what we have on file. Could you double-check and try again?",
    contextHint: shouldOfferEscalation
      ? "ZIP verification failed twice. Offer to escalate to a human agent."
      : "ZIP verification failed on first attempt. Ask customer to try again.",
    stateUpdates: {
      conversation: {
        ...ctx.getConversationState(),
        verification: {
          ...ctx.getConversationState().verification,
          verified: false,
          zipAttempts: newAttempts,
        },
      },
    },
  };
}

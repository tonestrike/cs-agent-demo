import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import {
  type VerifyWorkflowInput,
  type VerifyWorkflowOutput,
  verifyWorkflowInputSchema,
  verifyZipEventSchema,
} from "@pestcall/core";

import { createDependencies } from "../context";
import type { Env } from "../env";
import { lookupCustomerByPhone, verifyAccount } from "../use-cases/crm";
import { VERIFY_WORKFLOW_EVENT_ZIP } from "./constants";

const parseSummary = (summary: string | null) => {
  if (!summary) {
    return {};
  }
  try {
    return JSON.parse(summary) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const buildSummary = (summary: Record<string, unknown>) =>
  JSON.stringify(summary);

export class VerificationWorkflow extends WorkflowEntrypoint<
  Env,
  VerifyWorkflowInput
> {
  override async run(
    event: WorkflowEvent<VerifyWorkflowInput>,
    step: WorkflowStep,
  ): Promise<VerifyWorkflowOutput> {
    const input = verifyWorkflowInputSchema.safeParse(event.payload);
    if (!input.success) {
      throw new Error("Invalid verification workflow input.");
    }

    const params = input.data;
    const deps = createDependencies(this.env);
    const logger = deps.logger;

    const safeEscalate = async (reason: string, summary: string) => {
      try {
        await deps.crm.escalate({ reason, summary });
      } catch (error) {
        logger.warn(
          {
            callSessionId: params.callSessionId,
            instanceId: event.instanceId,
            error: error instanceof Error ? error.message : "unknown",
          },
          "workflow.verify.escalate_failed",
        );
      }
    };

    const updateSummary = async (
      workflowStep: string,
      details: Record<string, unknown> = {},
    ) => {
      const session = await deps.calls.getSession(params.callSessionId);
      const existing = parseSummary(session?.summary ?? null);
      const detailValues = details as {
        zipAttempts?: number;
        identityStatus?: string;
        verifiedCustomerId?: string | null;
        pendingCustomerId?: string | null;
        pendingCustomerProfile?: unknown;
      };
      const existingValues = existing as {
        zipAttempts?: number;
        identityStatus?: string;
        verifiedCustomerId?: string | null;
        pendingCustomerId?: string | null;
        pendingCustomerProfile?: unknown;
        workflowState?: { step?: string };
      };
      const zipAttempts =
        typeof detailValues.zipAttempts === "number"
          ? detailValues.zipAttempts
          : (existingValues.zipAttempts ?? 0);
      const nextSummary = {
        ...existing,
        identityStatus:
          detailValues.identityStatus ?? existingValues.identityStatus,
        verifiedCustomerId:
          detailValues.verifiedCustomerId ??
          existingValues.verifiedCustomerId ??
          null,
        pendingCustomerId:
          detailValues.pendingCustomerId ??
          existingValues.pendingCustomerId ??
          null,
        pendingCustomerProfile:
          detailValues.pendingCustomerProfile ??
          existingValues.pendingCustomerProfile ??
          null,
        workflowState: {
          kind: "verify",
          step: workflowStep,
          instanceId: event.instanceId,
          ...details,
        },
        zipAttempts,
      };
      await deps.calls.updateSessionSummary({
        callSessionId: params.callSessionId,
        summary: buildSummary(nextSummary),
      });
    };

    logger.info(
      { callSessionId: params.callSessionId, instanceId: event.instanceId },
      "workflow.verify.start",
    );

    let matches: Awaited<ReturnType<typeof lookupCustomerByPhone>> = [];
    try {
      matches = await step.do("lookup customer by phone", async () => {
        return lookupCustomerByPhone(deps.crm, params.phoneE164);
      });
    } catch (error) {
      await step.do("escalate lookup error", async () => {
        await updateSummary("escalate", {
          identityStatus: "unknown",
          pendingCustomerId: null,
          pendingCustomerProfile: null,
          lastError: "lookup_failed",
        });
        await safeEscalate(
          "Verification failed",
          "Unable to look up account by phone.",
        );
        return null;
      });
      return {
        status: "escalated",
        message:
          "I'm having trouble verifying the account right now. I'll connect you with a specialist.",
      };
    }

    if (!matches.length) {
      await step.do("escalate no matches", async () => {
        await updateSummary("escalate", {
          identityStatus: "unknown",
          pendingCustomerId: null,
          pendingCustomerProfile: null,
        });
        await safeEscalate(
          "Verification failed",
          "No customer found for provided phone number.",
        );
        return null;
      });
      return {
        status: "escalated",
        message:
          "I couldn't locate an account for that phone number. I'll connect you with a specialist.",
      };
    }

    const candidate = matches.length === 1 && matches[0] ? matches[0] : null;
    await step.do("record pending verification", async () => {
      await updateSummary("await_zip", {
        identityStatus: "pending",
        pendingCustomerId: candidate?.id ?? null,
        pendingCustomerProfile: candidate
          ? {
              id: candidate.id,
              displayName: candidate.displayName,
              phoneE164: candidate.phoneE164,
              addressSummary: candidate.addressSummary,
              zipCode: candidate.zipCode ?? null,
            }
          : null,
        candidateCount: matches.length,
        zipAttempts: 0,
      });
      return null;
    });

    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const zipEvent = await step.waitForEvent("await zip", {
        type: VERIFY_WORKFLOW_EVENT_ZIP,
        timeout: "24 hours",
      });
      const parsedZip = verifyZipEventSchema.safeParse(zipEvent.payload);
      if (!parsedZip.success) {
        await updateSummary("await_zip", {
          zipAttempts: attempt,
          lastError: "invalid_zip",
        });
        continue;
      }

      const zipCode = parsedZip.data.zipCode;
      let verifiedMatch: (typeof matches)[number] | null = null;
      try {
        verifiedMatch = await step.do("verify account", async () => {
          for (const match of matches) {
            if (await verifyAccount(deps.crm, match.id, zipCode)) {
              return match;
            }
          }
          return null;
        });
      } catch (error) {
        await step.do("escalate verify error", async () => {
          await updateSummary("escalate", {
            identityStatus: "pending",
            lastError: "verify_failed",
          });
          await safeEscalate(
            "Verification failed",
            "Unable to verify ZIP code due to a system error.",
          );
          return null;
        });
        return {
          status: "escalated",
          message:
            "I'm having trouble verifying the account right now. I'll connect you with a specialist.",
        };
      }

      if (verifiedMatch) {
        await step.do("record verified", async () => {
          await updateSummary("complete", {
            identityStatus: "verified",
            verifiedCustomerId: verifiedMatch.id,
            pendingCustomerId: null,
            pendingCustomerProfile: null,
            zipAttempts: 0,
          });
          await deps.calls.updateSessionCustomer({
            callSessionId: params.callSessionId,
            customerCacheId: verifiedMatch.id,
          });
          await deps.customers.upsert({
            id: verifiedMatch.id,
            crmCustomerId: verifiedMatch.id,
            displayName: verifiedMatch.displayName,
            phoneE164: verifiedMatch.phoneE164 ?? params.phoneE164,
            addressSummary: verifiedMatch.addressSummary ?? null,
            zipCode: verifiedMatch.zipCode ?? null,
            updatedAt: new Date().toISOString(),
          });
          return null;
        });
        return {
          status: "verified",
          customerId: verifiedMatch.id,
          message: "Thanks, you're verified.",
        };
      }

      await updateSummary("await_zip", {
        zipAttempts: attempt,
        lastError: "zip_mismatch",
      });
    }

    await step.do("escalate verification", async () => {
      await updateSummary("escalate", {
        identityStatus: "pending",
        lastError: "zip_failed",
      });
      await safeEscalate(
        "Verification failed",
        "ZIP verification failed after multiple attempts.",
      );
      return null;
    });

    return {
      status: "escalated",
      message:
        "I'm going to connect you with a specialist to verify your account.",
    };
  }
}

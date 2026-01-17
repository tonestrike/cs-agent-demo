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
import type { Logger } from "../logger";
import { lookupCustomerByPhone, verifyAccount } from "../use-cases/crm";
import { VERIFY_WORKFLOW_EVENT_ZIP } from "./constants";

const parseSummary = (summary: string | null, logger: Logger) => {
  if (!summary) {
    return {};
  }
  try {
    return JSON.parse(summary) as Record<string, unknown>;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "unknown" },
      "workflow.verify.summary.parse_failed",
    );
    return {};
  }
};

const buildSummary = (summary: Record<string, unknown>) =>
  JSON.stringify(summary);

type HubEvent =
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "final"; data: unknown };

export class VerificationWorkflow extends WorkflowEntrypoint<
  Env,
  VerifyWorkflowInput
> {
  override async run(
    event: WorkflowEvent<VerifyWorkflowInput>,
    step: WorkflowStep,
  ): Promise<VerifyWorkflowOutput> {
    const deps = createDependencies(this.env);
    const logger = deps.logger;
    const payload = (
      "params" in event ? event.params : event.payload
    ) as VerifyWorkflowInput;
    const input = verifyWorkflowInputSchema.safeParse(payload);
    if (!input.success) {
      logger.error(
        {
          instanceId: event.instanceId,
          payload,
          issues: input.error.issues,
        },
        "workflow.verify.invalid_input",
      );
      throw new Error("Invalid verification workflow input.");
    }

    const params = input.data;

    const publishToHub = async (hubEvent: HubEvent) => {
      if (!this.env.CONVERSATION_HUB) {
        return;
      }
      try {
        const id = this.env.CONVERSATION_HUB.idFromName(params.callSessionId);
        const stub = this.env.CONVERSATION_HUB.get(id);
        await stub.fetch("https://conversation-hub/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(hubEvent),
        });
        logger.info(
          {
            callSessionId: params.callSessionId,
            instanceId: event.instanceId,
            type: hubEvent.type,
          },
          "workflow.verify.hub.published",
        );
      } catch (error) {
        logger.error(
          {
            callSessionId: params.callSessionId,
            instanceId: event.instanceId,
            error:
              error instanceof Error
                ? { message: error.message, stack: error.stack }
                : error,
          },
          "workflow.verify.hub.publish_failed",
        );
      }
    };

    try {
      logger.info(
        {
          callSessionId: params.callSessionId,
          instanceId: event.instanceId,
          params,
        },
        "workflow.verify.params",
      );
      const safeEscalate = async (reason: string, summary: string) => {
        try {
          await deps.crm.escalate({ reason, summary });
        } catch (error) {
          logger.error(
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
        const existing = parseSummary(session?.summary ?? null, logger);
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
        logger.info(
          {
            callSessionId: params.callSessionId,
            instanceId: event.instanceId,
            workflowStep,
            details,
          },
          "workflow.verify.summary.updated",
        );
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
        logger.info(
          {
            callSessionId: params.callSessionId,
            instanceId: event.instanceId,
            matchCount: matches.length,
          },
          "workflow.verify.lookup.complete",
        );
      } catch (_error) {
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
        logger.info(
          {
            callSessionId: params.callSessionId,
            instanceId: event.instanceId,
            attempt,
          },
          "workflow.verify.await_zip",
        );
        const zipEvent = await step.waitForEvent("await zip", {
          type: VERIFY_WORKFLOW_EVENT_ZIP,
          timeout: "24 hours",
        });
        logger.info(
          {
            callSessionId: params.callSessionId,
            instanceId: event.instanceId,
            payload: zipEvent.payload,
          },
          "workflow.verify.zip.received",
        );
        const parsedZip = verifyZipEventSchema.safeParse(zipEvent.payload);
        if (!parsedZip.success) {
          logger.error(
            {
              callSessionId: params.callSessionId,
              instanceId: event.instanceId,
              issues: parsedZip.error.issues,
            },
            "workflow.verify.invalid_zip_event",
          );
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
          logger.info(
            {
              callSessionId: params.callSessionId,
              instanceId: event.instanceId,
              verifiedCustomerId: verifiedMatch?.id ?? null,
            },
            "workflow.verify.check.complete",
          );
        } catch (_error) {
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
            try {
              await deps.calls.updateSessionCustomer({
                callSessionId: params.callSessionId,
                customerCacheId: verifiedMatch.id,
              });
              logger.info(
                {
                  callSessionId: params.callSessionId,
                  instanceId: event.instanceId,
                  customerId: verifiedMatch.id,
                },
                "workflow.verify.session.customer_updated",
              );
            } catch (error) {
              logger.error(
                {
                  callSessionId: params.callSessionId,
                  instanceId: event.instanceId,
                  error:
                    error instanceof Error
                      ? { message: error.message, stack: error.stack }
                      : error,
                },
                "workflow.verify.session.customer_update_failed",
              );
              throw error;
            }
            const existingCustomer = await deps.customers.get(verifiedMatch.id);
            const participantId = existingCustomer?.participantId ?? null;
            try {
              await deps.customers.upsert({
                id: verifiedMatch.id,
                crmCustomerId: verifiedMatch.id,
                displayName: verifiedMatch.displayName,
                phoneE164: verifiedMatch.phoneE164 ?? params.phoneE164,
                addressSummary: verifiedMatch.addressSummary ?? null,
                zipCode: verifiedMatch.zipCode ?? null,
                participantId,
                updatedAt: new Date().toISOString(),
              });
              logger.info(
                {
                  callSessionId: params.callSessionId,
                  instanceId: event.instanceId,
                  customerId: verifiedMatch.id,
                },
                "workflow.verify.customer_cache.upserted",
              );
            } catch (error) {
              logger.error(
                {
                  callSessionId: params.callSessionId,
                  instanceId: event.instanceId,
                  error:
                    error instanceof Error
                      ? { message: error.message, stack: error.stack }
                      : error,
                },
                "workflow.verify.customer_cache.upsert_failed",
              );
              throw error;
            }
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
    } catch (error) {
      logger.error(
        {
          callSessionId: params.callSessionId,
          instanceId: event.instanceId,
          error:
            error instanceof Error
              ? { message: error.message, stack: error.stack }
              : error,
        },
        "workflow.verify.error",
      );
      try {
        const failureMessage =
          "I'm having trouble verifying your account right now. I'll connect you with a specialist.";
        await deps.calls.updateSessionSummary({
          callSessionId: params.callSessionId,
          summary: buildSummary({
            identityStatus: "unknown",
            workflowState: {
              kind: "verify",
              step: "escalate",
              instanceId: event.instanceId,
              lastError: "workflow_error",
            },
            callSummary: failureMessage,
          }),
        });
        await deps.calls.addTurn({
          id: crypto.randomUUID(),
          callSessionId: params.callSessionId,
          ts: new Date().toISOString(),
          speaker: "agent",
          text: failureMessage,
          meta: {
            intent: "final",
            toolName: "workflow.verify",
            error: "workflow_error",
          },
        });
        await publishToHub({
          type: "final",
          data: {
            callSessionId: params.callSessionId,
            replyText: failureMessage,
          },
        });
      } catch (notifyError) {
        logger.error(
          {
            callSessionId: params.callSessionId,
            instanceId: event.instanceId,
            error:
              notifyError instanceof Error
                ? { message: notifyError.message, stack: notifyError.stack }
                : notifyError,
          },
          "workflow.verify.notify_failed",
        );
      }
      throw error;
    }
  }
}

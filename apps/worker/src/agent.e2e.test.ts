import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";

type RpcResponse<T> = {
  json: T;
  meta: unknown[];
};

interface E2EEnv {
  E2E_BASE_URL?: string;
  E2E_AUTH_TOKEN?: string;
  DEMO_AUTH_TOKEN?: string;
  E2E_PHONE?: string;
}

const env = process.env as E2EEnv;
const baseUrl = env.E2E_BASE_URL ?? "http://127.0.0.1:8787";
const authToken = env.E2E_AUTH_TOKEN ?? env.DEMO_AUTH_TOKEN;
const phoneNumber = env.E2E_PHONE ?? "+14155550987";

const describeIf = env.E2E_BASE_URL ? describe : describe.skip;

const callRpc = async <T>(
  path: string,
  input?: Record<string, unknown>,
): Promise<T> => {
  const request = new Request(new URL(`/rpc/${path}`, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authToken ? { "x-demo-auth": authToken } : {}),
    },
    body: JSON.stringify({
      json: input ?? {},
      meta: [],
    }),
  });

  const response = await fetch(request);
  const data = (await response.json()) as RpcResponse<T>;
  if (!response.ok) {
    throw new Error(JSON.stringify(data.json));
  }
  return data.json;
};

type Summary = {
  identityStatus?: string;
  verifiedCustomerId?: string;
  workflowState?: { instanceId?: string; step?: string };
  lastAppointmentOptions?: Array<{ id: string }>;
  lastAvailableSlots?: Array<{ id: string }>;
};

const getSessionSummary = async (callSessionId: string) => {
  const detail = await callRpc<{
    session: { summary: string | null };
  }>("calls/get", { callSessionId });
  if (!detail.session?.summary) {
    return null;
  }
  try {
    return JSON.parse(detail.session.summary) as Summary;
  } catch {
    return null;
  }
};

const waitForSummary = async (
  callSessionId: string,
  predicate: (summary: Summary) => boolean,
  attempts = 20,
  delayMs = 250,
) => {
  for (let i = 0; i < attempts; i += 1) {
    const summary = await getSessionSummary(callSessionId);
    if (summary && predicate(summary)) {
      return summary;
    }
    await delay(delayMs);
  }
  throw new Error("Timed out waiting for summary update.");
};

describeIf.skip("agent e2e workflows", () => {
  it("verifies identity from ZIP input", async () => {
    const first = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      phoneNumber,
      text: "hello",
    });

    expect(first.replyText.length).toBeGreaterThan(0);

    await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: first.callSessionId,
      phoneNumber,
      text: "98109",
    });

    const summary = await waitForSummary(first.callSessionId, (value) => {
      return value.identityStatus === "verified";
    });

    expect(summary.identityStatus).toBe("verified");
    expect(summary.verifiedCustomerId).toBe("cust_002");
  });

  it("reschedules via workflow events", async () => {
    const start = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      phoneNumber,
      text: "hello",
    });

    await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: start.callSessionId,
      phoneNumber,
      text: "98109",
    });

    await waitForSummary(start.callSessionId, (value) => {
      return value.identityStatus === "verified";
    });

    const startWorkflow = await callRpc<{ instanceId: string }>(
      "workflows/reschedule/start",
      {
        callSessionId: start.callSessionId,
        customerId: "cust_002",
        intent: "reschedule",
        message: "I need to reschedule my appointment.",
      },
    );

    const workflowSummary = await waitForSummary(
      start.callSessionId,
      (value) => {
        return value.workflowState?.instanceId === startWorkflow.instanceId;
      },
    );

    const workflowState = workflowSummary.workflowState ?? {};
    expect(workflowState.instanceId).toBe(startWorkflow.instanceId);

    const appointmentOptions = workflowSummary.lastAppointmentOptions ?? [];
    expect(appointmentOptions.length).toBeGreaterThan(0);

    await callRpc<{ ok: boolean; instanceId: string }>(
      "workflows/reschedule/selectAppointment",
      {
        instanceId: workflowState.instanceId,
        payload: { appointmentId: appointmentOptions[0]?.id },
      },
    );

    const slotSummary = await waitForSummary(start.callSessionId, (value) => {
      return (
        Array.isArray(value.lastAvailableSlots) &&
        value.lastAvailableSlots.length > 0
      );
    });

    const slots = slotSummary.lastAvailableSlots ?? [];
    await callRpc<{ ok: boolean; instanceId: string }>(
      "workflows/reschedule/selectSlot",
      {
        instanceId: workflowState.instanceId,
        payload: { slotId: slots[0]?.id },
      },
    );

    await waitForSummary(start.callSessionId, (value) => {
      return value.workflowState?.step === "confirm";
    });

    await callRpc<{ ok: boolean; instanceId: string }>(
      "workflows/reschedule/confirm",
      {
        instanceId: workflowState.instanceId,
        payload: { confirmed: true },
      },
    );

    const completeSummary = await waitForSummary(
      start.callSessionId,
      (value) => {
        return value.workflowState?.step === "complete";
      },
    );

    const finalWorkflow = completeSummary.workflowState ?? {};
    expect(finalWorkflow.step).toBe("complete");
  });

  it("cancels via workflow events", async () => {
    const start = await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      phoneNumber,
      text: "hello",
    });

    await callRpc<{
      callSessionId: string;
      replyText: string;
    }>("agent/message", {
      callSessionId: start.callSessionId,
      phoneNumber,
      text: "98109",
    });

    await waitForSummary(start.callSessionId, (value) => {
      return value.identityStatus === "verified";
    });

    const startWorkflow = await callRpc<{ instanceId: string }>(
      "workflows/cancel/start",
      {
        callSessionId: start.callSessionId,
        customerId: "cust_002",
        intent: "cancel",
        message: "Cancel my appointment.",
      },
    );

    const workflowSummary = await waitForSummary(
      start.callSessionId,
      (value) => {
        return value.workflowState?.instanceId === startWorkflow.instanceId;
      },
    );

    const workflowState = workflowSummary.workflowState ?? {};
    expect(workflowState.instanceId).toBe(startWorkflow.instanceId);

    const appointmentOptions = workflowSummary.lastAppointmentOptions ?? [];
    expect(appointmentOptions.length).toBeGreaterThan(0);

    await callRpc<{ ok: boolean; instanceId: string }>(
      "workflows/cancel/selectAppointment",
      {
        instanceId: workflowState.instanceId,
        payload: { appointmentId: appointmentOptions[0]?.id },
      },
    );

    await waitForSummary(start.callSessionId, (value) => {
      return value.workflowState?.step === "confirm";
    });

    await callRpc<{ ok: boolean; instanceId: string }>(
      "workflows/cancel/confirm",
      {
        instanceId: workflowState.instanceId,
        payload: { confirmed: true },
      },
    );

    const completeSummary = await waitForSummary(
      start.callSessionId,
      (value) => {
        return value.workflowState?.step === "complete";
      },
    );

    const finalWorkflow = completeSummary.workflowState ?? {};
    expect(finalWorkflow.step).toBe("complete");
  });
});

import { ORPCError } from "@orpc/server";
import {
  cancelWorkflowConfirmEventInputSchema,
  cancelWorkflowSelectAppointmentEventInputSchema,
  cancelWorkflowStartInputSchema,
  cancelWorkflowStartOutputSchema,
  rescheduleWorkflowConfirmEventInputSchema,
  rescheduleWorkflowSelectAppointmentEventInputSchema,
  rescheduleWorkflowSelectSlotEventInputSchema,
  rescheduleWorkflowStartInputSchema,
  rescheduleWorkflowStartOutputSchema,
  verifyWorkflowStartInputSchema,
  verifyWorkflowStartOutputSchema,
  verifyWorkflowZipEventInputSchema,
  workflowEventAckSchema,
} from "@pestcall/core";

import { authedProcedure } from "../middleware/auth";
import {
  CANCEL_WORKFLOW_EVENT_CONFIRM,
  CANCEL_WORKFLOW_EVENT_SELECT_APPOINTMENT,
  RESCHEDULE_WORKFLOW_EVENT_CONFIRM,
  RESCHEDULE_WORKFLOW_EVENT_SELECT_APPOINTMENT,
  RESCHEDULE_WORKFLOW_EVENT_SELECT_SLOT,
  VERIFY_WORKFLOW_EVENT_ZIP,
} from "../workflows/constants";

const requireWorkflow = (workflow: Workflow | undefined, name: string) => {
  if (!workflow) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: `${name} workflow binding is not configured.`,
    });
  }
  return workflow;
};

export const workflowProcedures = {
  verify: {
    start: authedProcedure
      .input(verifyWorkflowStartInputSchema)
      .output(verifyWorkflowStartOutputSchema)
      .handler(async ({ input, context }) => {
        const workflow = requireWorkflow(context.env.VERIFY_WORKFLOW, "Verify");
        const { workflowInstanceId, ...params } = input;
        const instance = await workflow.create({
          id: workflowInstanceId,
          params,
        });
        return { instanceId: instance.id };
      }),
    sendZip: authedProcedure
      .input(verifyWorkflowZipEventInputSchema)
      .output(workflowEventAckSchema)
      .handler(async ({ input, context }) => {
        const workflow = requireWorkflow(context.env.VERIFY_WORKFLOW, "Verify");
        const instance = await workflow.get(input.instanceId);
        await instance.sendEvent({
          type: VERIFY_WORKFLOW_EVENT_ZIP,
          payload: input.payload,
        });
        return { ok: true, instanceId: input.instanceId };
      }),
  },
  reschedule: {
    start: authedProcedure
      .input(rescheduleWorkflowStartInputSchema)
      .output(rescheduleWorkflowStartOutputSchema)
      .handler(async ({ input, context }) => {
        const workflow = requireWorkflow(
          context.env.RESCHEDULE_WORKFLOW,
          "Reschedule",
        );
        const { workflowInstanceId, ...params } = input;
        const instance = await workflow.create({
          id: workflowInstanceId,
          params,
        });
        return { instanceId: instance.id };
      }),
    selectAppointment: authedProcedure
      .input(rescheduleWorkflowSelectAppointmentEventInputSchema)
      .output(workflowEventAckSchema)
      .handler(async ({ input, context }) => {
        const workflow = requireWorkflow(
          context.env.RESCHEDULE_WORKFLOW,
          "Reschedule",
        );
        const instance = await workflow.get(input.instanceId);
        await instance.sendEvent({
          type: RESCHEDULE_WORKFLOW_EVENT_SELECT_APPOINTMENT,
          payload: input.payload,
        });
        return { ok: true, instanceId: input.instanceId };
      }),
    selectSlot: authedProcedure
      .input(rescheduleWorkflowSelectSlotEventInputSchema)
      .output(workflowEventAckSchema)
      .handler(async ({ input, context }) => {
        const workflow = requireWorkflow(
          context.env.RESCHEDULE_WORKFLOW,
          "Reschedule",
        );
        const instance = await workflow.get(input.instanceId);
        await instance.sendEvent({
          type: RESCHEDULE_WORKFLOW_EVENT_SELECT_SLOT,
          payload: input.payload,
        });
        return { ok: true, instanceId: input.instanceId };
      }),
    confirm: authedProcedure
      .input(rescheduleWorkflowConfirmEventInputSchema)
      .output(workflowEventAckSchema)
      .handler(async ({ input, context }) => {
        const workflow = requireWorkflow(
          context.env.RESCHEDULE_WORKFLOW,
          "Reschedule",
        );
        const instance = await workflow.get(input.instanceId);
        await instance.sendEvent({
          type: RESCHEDULE_WORKFLOW_EVENT_CONFIRM,
          payload: input.payload,
        });
        return { ok: true, instanceId: input.instanceId };
      }),
  },
  cancel: {
    start: authedProcedure
      .input(cancelWorkflowStartInputSchema)
      .output(cancelWorkflowStartOutputSchema)
      .handler(async ({ input, context }) => {
        const workflow = requireWorkflow(context.env.CANCEL_WORKFLOW, "Cancel");
        const { workflowInstanceId, ...params } = input;
        const instance = await workflow.create({
          id: workflowInstanceId,
          params,
        });
        return { instanceId: instance.id };
      }),
    selectAppointment: authedProcedure
      .input(cancelWorkflowSelectAppointmentEventInputSchema)
      .output(workflowEventAckSchema)
      .handler(async ({ input, context }) => {
        const workflow = requireWorkflow(context.env.CANCEL_WORKFLOW, "Cancel");
        const instance = await workflow.get(input.instanceId);
        await instance.sendEvent({
          type: CANCEL_WORKFLOW_EVENT_SELECT_APPOINTMENT,
          payload: input.payload,
        });
        return { ok: true, instanceId: input.instanceId };
      }),
    confirm: authedProcedure
      .input(cancelWorkflowConfirmEventInputSchema)
      .output(workflowEventAckSchema)
      .handler(async ({ input, context }) => {
        const workflow = requireWorkflow(context.env.CANCEL_WORKFLOW, "Cancel");
        const instance = await workflow.get(input.instanceId);
        await instance.sendEvent({
          type: CANCEL_WORKFLOW_EVENT_CONFIRM,
          payload: input.payload,
        });
        return { ok: true, instanceId: input.instanceId };
      }),
  },
};

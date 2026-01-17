/**
 * Handler for crm.getServicePolicy tool
 */

import { getServicePolicy } from "../../../../use-cases/crm";
import type {
  ToolExecutionInput,
  ToolFlowContext,
  ToolRawResult,
} from "../types";

export async function handleGetServicePolicy(
  ctx: ToolFlowContext,
  { args }: ToolExecutionInput<"crm.getServicePolicy">,
): Promise<ToolRawResult> {
  const policyText = await getServicePolicy(ctx.deps.crm, args.topic);

  return {
    toolName: "crm.getServicePolicy",
    result: { text: policyText },
    fallback: policyText,
    contextHint: "Share the requested service policy.",
  };
}

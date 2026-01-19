/**
 * Handler for crm.getOpenInvoices tool
 */

import { getOpenInvoices } from "../../../../use-cases/crm";
import { formatInvoicesResponse } from "../../formatters";
import type {
  ToolExecutionInput,
  ToolFlowContext,
  ToolRawResult,
} from "../types";

export async function handleGetInvoices(
  ctx: ToolFlowContext,
  { args }: ToolExecutionInput<"crm.getOpenInvoices">,
): Promise<ToolRawResult> {
  // Always use the session's verified customerId - never trust model input for customer identity
  const customerId =
    ctx.sessionState.conversation?.verification.customerId ??
    args.customerId ??
    "";

  const invoices = await getOpenInvoices(ctx.deps.crm, customerId);

  if (invoices.length === 0) {
    return {
      toolName: "crm.getOpenInvoices",
      result: { invoiceCount: 0, balanceCents: 0 },
      fallback: "You're all set. I don't see any open invoices right now.",
      contextHint: "Confirm no outstanding balance.",
    };
  }

  const balanceCents = invoices.reduce(
    (sum, invoice) => sum + (invoice.balanceCents ?? 0),
    0,
  );
  const balance =
    invoices.find((invoice) => invoice.balance)?.balance ??
    (balanceCents / 100).toFixed(2);
  const currency = invoices.find((invoice) => invoice.currency)?.currency;

  return {
    toolName: "crm.getOpenInvoices",
    result: {
      balanceCents,
      balance,
      currency,
      invoiceCount: invoices.length,
    },
    fallback: formatInvoicesResponse(invoices),
    contextHint: "Share the balance and invoice status.",
  };
}

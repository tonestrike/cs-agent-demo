/**
 * Pure functions for formatting invoice data
 */

import type { InvoiceData } from "../types";

/**
 * Format a list of invoices for display
 */
export function formatInvoicesResponse(invoices: InvoiceData[]): string {
  const intro =
    invoices.length === 1
      ? "Here is your open invoice:"
      : "Here are your open invoices:";
  const lines = invoices.map((invoice, index) => {
    const balance = invoice.balance ?? (invoice.balanceCents / 100).toFixed(2);
    const currency = invoice.currency ?? "USD";
    const amount =
      currency === "USD" ? `$${balance}` : `${balance} ${currency}`;
    const status = invoice.status === "overdue" ? " (overdue)" : "";
    return `${index + 1}) ${amount} due ${invoice.dueDate}${status}`;
  });
  return [intro, ...lines].join(" ");
}

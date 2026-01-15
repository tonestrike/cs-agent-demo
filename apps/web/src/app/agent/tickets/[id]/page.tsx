"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Badge, Card } from "../../../../components/ui";
import { callRpc } from "../../../../lib/api";

type Ticket = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  priority: string;
  category: string;
  customerCacheId?: string;
  phoneE164?: string;
  subject: string;
  description: string;
  assignee?: string;
  source: string;
  externalRef?: string;
};

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const maskPhone = (phoneE164: string | undefined) => {
  if (!phoneE164) {
    return "Unknown";
  }
  const last4 = phoneE164.slice(-4);
  return `***-${last4}`;
};

export default function TicketDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const ticketQuery = useQuery({
    queryKey: ["ticket", params.id],
    queryFn: () =>
      callRpc<Ticket>("tickets/get", {
        ticketId: params.id,
      }),
  });

  return (
    <main className="grid-dots min-h-screen px-6 py-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Link href="/agent" className="text-xs uppercase text-ink/60">
          ← Back to dashboard
        </Link>
        <Card className="flex flex-col gap-3">
          <Badge className="w-fit">Ticket Detail</Badge>
          {ticketQuery.data ? (
            <>
              <h1 className="text-2xl font-semibold text-ink">
                {ticketQuery.data.subject}
              </h1>
              <p className="text-sm text-ink/60">
                {ticketQuery.data.status} • {ticketQuery.data.category} •{" "}
                {ticketQuery.data.priority}
              </p>
              <p className="text-sm text-ink/60">
                {maskPhone(ticketQuery.data.phoneE164)} •{" "}
                {formatDateTime(ticketQuery.data.createdAt)}
              </p>
            </>
          ) : (
            <p className="text-sm text-ink/60">Loading ticket...</p>
          )}
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">Description</h2>
          <p className="text-sm text-ink/80">
            {ticketQuery.data?.description ?? "Loading details..."}
          </p>
        </Card>
      </div>
    </main>
  );
}

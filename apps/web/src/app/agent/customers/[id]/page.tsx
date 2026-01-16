"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import type { CallSession, ServiceAppointment, Ticket } from "@pestcall/core";

import { Badge, Card } from "../../../../components/ui";
import { rpcClient } from "../../../../lib/orpc";

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const maskPhone = (phoneE164: string) => {
  const last4 = phoneE164.slice(-4);
  return `***-${last4}`;
};

export default function CustomerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const customerQuery = useQuery({
    queryKey: ["customer", params.id],
    queryFn: () =>
      rpcClient.customers.get({
        customerId: params.id,
      }),
  });

  const callsQuery = useQuery({
    queryKey: ["customer-calls", params.id, customerQuery.data?.phoneE164],
    queryFn: () =>
      rpcClient.calls.list({
        limit: 50,
        phoneE164: customerQuery.data?.phoneE164 ?? undefined,
      }),
    enabled: Boolean(customerQuery.data?.phoneE164),
  });

  const ticketsQuery = useQuery({
    queryKey: ["customer-tickets", params.id, customerQuery.data?.phoneE164],
    queryFn: () =>
      rpcClient.tickets.list({
        limit: 50,
        phoneE164: customerQuery.data?.phoneE164 ?? undefined,
      }),
    enabled: Boolean(customerQuery.data?.phoneE164),
  });

  const appointmentsQuery = useQuery({
    queryKey: ["customer-appointments", params.id],
    queryFn: () =>
      rpcClient.appointments.list({
        limit: 50,
        customerId: params.id,
        refresh: true,
      }),
  });

  return (
    <main className="grid-dots min-h-screen px-6 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Link href="/agent" className="text-xs uppercase text-ink/60">
          ← Back to dashboard
        </Link>
        <Card className="flex flex-col gap-3 animate-rise">
          <Badge className="w-fit">Customer</Badge>
          {customerQuery.data ? (
            <>
              <h1 className="text-2xl font-semibold text-ink">
                {customerQuery.data.displayName}
              </h1>
              <p className="text-sm text-ink/60">
                {maskPhone(customerQuery.data.phoneE164)}
                {customerQuery.data.addressSummary
                  ? ` • ${customerQuery.data.addressSummary}`
                  : ""}
              </p>
              <p className="text-xs text-ink/50">
                Updated {formatDateTime(customerQuery.data.updatedAt)}
              </p>
            </>
          ) : customerQuery.isError ? (
            <p className="text-sm text-ink/60">Customer not found.</p>
          ) : (
            <p className="text-sm text-ink/60">Loading customer...</p>
          )}
        </Card>

        <Card className="flex flex-col gap-4 animate-rise">
          <h2 className="text-lg font-semibold text-ink">Calls</h2>
          <div className="space-y-3">
            {(callsQuery.data?.items ?? []).map((session: CallSession) => (
              <div
                key={session.id}
                className="rounded-2xl border border-ink/10 bg-white/80 p-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-ink/60">
                      {formatDateTime(session.startedAt)} • {session.status}
                    </p>
                    <p className="text-[11px] uppercase tracking-wide text-ink/50">
                      {session.transport}
                    </p>
                  </div>
                  <Link
                    href={`/agent/calls/${session.id}`}
                    className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink/70 transition hover:border-ink/40 hover:text-ink"
                  >
                    Transcript
                  </Link>
                </div>
              </div>
            ))}
            {callsQuery.isLoading && (
              <p className="text-sm text-ink/60">Loading calls...</p>
            )}
            {!callsQuery.isLoading &&
            (callsQuery.data?.items ?? []).length === 0 ? (
              <p className="text-sm text-ink/60">No calls yet.</p>
            ) : null}
          </div>
        </Card>

        <Card className="flex flex-col gap-4 animate-rise">
          <h2 className="text-lg font-semibold text-ink">Tickets</h2>
          <div className="space-y-3">
            {(ticketsQuery.data?.items ?? []).map((ticket: Ticket) => (
              <div
                key={ticket.id}
                className="rounded-2xl border border-ink/10 bg-white/80 p-4"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink">
                    {ticket.subject}
                  </p>
                  <span className="text-xs uppercase text-ink/50">
                    {ticket.status}
                  </span>
                </div>
                <p className="mt-2 text-xs text-ink/60">
                  {ticket.category} • {ticket.priority}
                </p>
                <div className="mt-3">
                  <Link
                    href={`/agent/tickets/${ticket.id}`}
                    className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink/70 transition hover:border-ink/40 hover:text-ink"
                  >
                    Ticket
                  </Link>
                </div>
              </div>
            ))}
            {ticketsQuery.isLoading && (
              <p className="text-sm text-ink/60">Loading tickets...</p>
            )}
            {!ticketsQuery.isLoading &&
            (ticketsQuery.data?.items ?? []).length === 0 ? (
              <p className="text-sm text-ink/60">No tickets yet.</p>
            ) : null}
          </div>
        </Card>

        <Card className="flex flex-col gap-4 animate-rise">
          <h2 className="text-lg font-semibold text-ink">Appointments</h2>
          <div className="space-y-3">
            {(appointmentsQuery.data?.items ?? []).map(
              (appointment: ServiceAppointment) => (
                <div
                  key={appointment.id}
                  className="rounded-2xl border border-ink/10 bg-white/80 p-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-ink">
                      {appointment.date} • {appointment.timeWindow}
                    </p>
                    <span className="text-xs uppercase text-ink/50">
                      {appointment.status}
                    </span>
                  </div>
                  {appointment.rescheduledFromId ? (
                    <p className="mt-2 text-xs text-ink/50">
                      Rescheduled from {appointment.rescheduledFromId}
                    </p>
                  ) : null}
                </div>
              ),
            )}
            {appointmentsQuery.isLoading && (
              <p className="text-sm text-ink/60">Loading appointments...</p>
            )}
            {!appointmentsQuery.isLoading &&
            (appointmentsQuery.data?.items ?? []).length === 0 ? (
              <p className="text-sm text-ink/60">No appointments yet.</p>
            ) : null}
          </div>
        </Card>
      </div>
    </main>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import type { CallSession, ServiceAppointment, Ticket } from "@pestcall/core";

import { Badge, Button, Card } from "../../../../components/ui";
import { orpc } from "../../../../lib/orpc";

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function CustomerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [activeTab, setActiveTab] = useState<
    "calls" | "tickets" | "appointments"
  >("calls");
  const customerQuery = useQuery(
    orpc.customers.get.queryOptions({
      input: { customerId: params.id },
    }),
  );

  const callsQuery = useQuery(
    orpc.calls.list.queryOptions({
      input: { limit: 50, customerCacheId: params.id },
      enabled: Boolean(params.id),
    }),
  );

  const ticketsQuery = useQuery(
    orpc.tickets.list.queryOptions({
      input: { limit: 50, customerCacheId: params.id },
      enabled: Boolean(params.id),
    }),
  );

  const appointmentsQuery = useQuery(
    orpc.appointments.list.queryOptions({
      input: { limit: 50, customerId: params.id, refresh: true },
    }),
  );

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
                {customerQuery.data.phoneE164}
                {customerQuery.data.zipCode
                  ? ` • ${customerQuery.data.zipCode}`
                  : ""}
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

        <Card className="flex items-center gap-3 overflow-x-auto animate-rise">
          <Button
            className={
              activeTab === "calls"
                ? "bg-ink shrink-0"
                : "bg-white/90 shrink-0 !text-ink hover:bg-ink hover:!text-sand border border-ink/20"
            }
            onClick={() => setActiveTab("calls")}
          >
            Calls
          </Button>
          <Button
            className={
              activeTab === "tickets"
                ? "bg-ink shrink-0"
                : "bg-white/90 shrink-0 !text-ink hover:bg-ink hover:!text-sand border border-ink/20"
            }
            onClick={() => setActiveTab("tickets")}
          >
            Tickets
          </Button>
          <Button
            className={
              activeTab === "appointments"
                ? "bg-ink shrink-0"
                : "bg-white/90 shrink-0 !text-ink hover:bg-ink hover:!text-sand border border-ink/20"
            }
            onClick={() => setActiveTab("appointments")}
          >
            Appointments
          </Button>
        </Card>

        {activeTab === "calls" ? (
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
                      {session.callSummary ? (
                        <p className="mt-2 text-xs text-ink/60">
                          {session.callSummary}
                        </p>
                      ) : null}
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
        ) : null}

        {activeTab === "tickets" ? (
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
        ) : null}

        {activeTab === "appointments" ? (
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
        ) : null}
      </div>
    </main>
  );
}

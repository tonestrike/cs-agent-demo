"use client";

import type {
  CallSession,
  CustomerCache,
  ServiceAppointment,
  Ticket,
} from "@pestcall/core";
import { useQueries, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Badge, Button, Card } from "../../components/ui";
import { rpcClient } from "../../lib/orpc";

const maskPhone = (phoneE164: string) => {
  const last4 = phoneE164.slice(-4);
  return `***-${last4}`;
};

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function AgentDashboardPage() {
  const [activeTab, setActiveTab] = useState<
    "calls" | "tickets" | "appointments" | "customers"
  >("calls");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customersItems, setCustomersItems] = useState<CustomerCache[]>([]);
  const [customersCursor, setCustomersCursor] = useState<string | null>(null);
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketStatus, setTicketStatus] = useState<
    "open" | "in_progress" | "resolved" | "all"
  >("open");
  const [callsItems, setCallsItems] = useState<CallSession[]>([]);
  const [callsCursor, setCallsCursor] = useState<string | null>(null);
  const [appointmentsItems, setAppointmentsItems] = useState<
    ServiceAppointment[]
  >([]);
  const [appointmentsCursor, setAppointmentsCursor] = useState<string | null>(
    null,
  );
  const [appointmentsRefreshKey, setAppointmentsRefreshKey] = useState(0);
  const callsQuery = useQuery({
    queryKey: ["calls", callsCursor],
    queryFn: () =>
      rpcClient.calls.list({ limit: 100, cursor: callsCursor ?? undefined }),
    refetchInterval: 4000,
  });

  const ticketsQuery = useQuery({
    queryKey: ["tickets", ticketSearch, ticketStatus],
    queryFn: () =>
      rpcClient.tickets.list({
        limit: 50,
        q: ticketSearch || undefined,
        status: ticketStatus === "all" ? undefined : ticketStatus,
      }),
  });

  const appointmentsQuery = useQuery({
    queryKey: ["appointments", appointmentsCursor, appointmentsRefreshKey],
    queryFn: () =>
      rpcClient.appointments.list({
        limit: 50,
        cursor: appointmentsCursor ?? undefined,
        refresh:
          appointmentsRefreshKey > 0 && !appointmentsCursor ? true : undefined,
      }),
  });

  const customersQuery = useQuery({
    queryKey: ["customers", customerSearch, customersCursor],
    queryFn: () =>
      rpcClient.customers.list({
        limit: 50,
        q: customerSearch || undefined,
        cursor: customersCursor ?? undefined,
      }),
  });

  const ticketCallLookups = useQueries({
    queries: (ticketsQuery.data?.items ?? []).map((ticket: Ticket) => ({
      queryKey: ["call-by-ticket", ticket.id],
      queryFn: () => rpcClient.calls.findByTicketId({ ticketId: ticket.id }),
      enabled: Boolean(ticket.id),
    })),
  });

  useEffect(() => {
    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem("agent-dashboard-tab")
        : null;
    if (
      stored === "calls" ||
      stored === "tickets" ||
      stored === "appointments" ||
      stored === "customers"
    ) {
      setActiveTab(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("agent-dashboard-tab", activeTab);
    }
  }, [activeTab]);

  useEffect(() => {
    const items = callsQuery.data?.items ?? [];
    if (items.length === 0) {
      return;
    }
    setCallsItems((prev) => {
      const seen = new Set(prev.map((item) => item.id));
      const merged = [...prev];
      for (const item of items) {
        if (!seen.has(item.id)) {
          merged.push(item);
        }
      }
      return merged;
    });
    setCallsCursor(callsQuery.data?.nextCursor ?? null);
  }, [callsQuery.data]);

  useEffect(() => {
    const items = appointmentsQuery.data?.items ?? [];
    if (items.length === 0) {
      return;
    }
    setAppointmentsItems((prev) => {
      const seen = new Set(prev.map((item) => item.id));
      const merged = [...prev];
      for (const item of items) {
        if (!seen.has(item.id)) {
          merged.push(item);
        }
      }
      return merged;
    });
    setAppointmentsCursor(appointmentsQuery.data?.nextCursor ?? null);
  }, [appointmentsQuery.data]);

  useEffect(() => {
    const items = customersQuery.data?.items ?? [];
    if (items.length === 0) {
      return;
    }
    setCustomersItems((prev) => {
      const seen = new Set(prev.map((item) => item.id));
      const merged = [...prev];
      for (const item of items) {
        if (!seen.has(item.id)) {
          merged.push(item);
        }
      }
      return merged;
    });
    setCustomersCursor(customersQuery.data?.nextCursor ?? null);
  }, [customersQuery.data]);

  const ticketCallMap = useMemo(() => {
    const entries = (ticketsQuery.data?.items ?? []).map((ticket, index) => {
      const data = ticketCallLookups[index]?.data;
      return [ticket.id, data?.callSessionId ?? null] as const;
    });
    return new Map(entries);
  }, [ticketCallLookups, ticketsQuery.data?.items]);

  const groupedCalls = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        phoneE164: string;
        customerCacheId: string | null;
        sessions: CallSession[];
      }
    >();
    for (const session of callsItems) {
      const key = session.customerCacheId ?? session.phoneE164;
      const existing = map.get(key);
      if (existing) {
        existing.sessions.push(session);
      } else {
        map.set(key, {
          key,
          phoneE164: session.phoneE164,
          customerCacheId: session.customerCacheId,
          sessions: [session],
        });
      }
    }
    const grouped = Array.from(map.values()).map((entry) => {
      const sorted = entry.sessions.sort((a, b) =>
        a.startedAt < b.startedAt ? 1 : -1,
      );
      return {
        ...entry,
        sessions: sorted,
        count: sorted.length,
        latestStartedAt: sorted[0]?.startedAt ?? entry.sessions[0]?.startedAt,
      };
    });
    return grouped.sort((a, b) =>
      (a.latestStartedAt ?? "") < (b.latestStartedAt ?? "") ? 1 : -1,
    );
  }, [callsItems]);

  return (
    <main className="grid-dots min-h-screen px-6 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4">
          <Badge className="w-fit">Agent Dashboard</Badge>
          <h1 className="text-3xl font-semibold text-ink sm:text-4xl">
            The <span className="accent-text">PestCall</span> operations hub.
          </h1>
          <p className="max-w-3xl text-ink/70">
            Track call sessions, inspect model/tool behavior, and manage tickets
            without leaving the command center.
          </p>
        </header>

        <Card className="flex flex-wrap items-center gap-3">
          <Button
            className={
              activeTab === "calls"
                ? "bg-ink"
                : "bg-white/90 !text-ink hover:bg-ink hover:!text-sand border border-ink/20"
            }
            onClick={() => setActiveTab("calls")}
          >
            Calls
          </Button>
          <Button
            className={
              activeTab === "tickets"
                ? "bg-ink"
                : "bg-white/90 !text-ink hover:bg-ink hover:!text-sand border border-ink/20"
            }
            onClick={() => setActiveTab("tickets")}
          >
            Tickets
          </Button>
          <Button
            className={
              activeTab === "appointments"
                ? "bg-ink"
                : "bg-white/90 !text-ink hover:bg-ink hover:!text-sand border border-ink/20"
            }
            onClick={() => setActiveTab("appointments")}
          >
            Appointments
          </Button>
          <Button
            className={
              activeTab === "customers"
                ? "bg-ink"
                : "bg-white/90 !text-ink hover:bg-ink hover:!text-sand border border-ink/20"
            }
            onClick={() => setActiveTab("customers")}
          >
            Customers
          </Button>
        </Card>

        {activeTab === "calls" ? (
          <Card className="flex flex-col gap-5 animate-rise">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Calls by Customer</h2>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="bg-moss hover:bg-ink"
                  onClick={() => {
                    setCallsItems([]);
                    setCallsCursor(null);
                    callsQuery.refetch();
                  }}
                >
                  Refresh
                </Button>
                {callsQuery.data?.nextCursor ? (
                  <Button
                    className="bg-white/80 text-ink hover:bg-ink hover:text-sand"
                    onClick={() =>
                      setCallsCursor(callsQuery.data?.nextCursor ?? null)
                    }
                  >
                    Load more
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="scroll-area max-h-[520px] space-y-3 overflow-y-auto pr-1">
              {groupedCalls.map((group) => (
                <div
                  key={group.key}
                  className="rounded-2xl border border-ink/10 bg-white/70 p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {maskPhone(group.phoneE164)}
                      </p>
                      <p className="text-xs text-ink/60">
                        {group.customerCacheId ?? "Unknown customer"} •{" "}
                        {group.count} sessions
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {group.sessions.map((session) => (
                      <div
                        key={session.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-ink/10 bg-white/80 p-3"
                      >
                        <div>
                          <p className="text-xs text-ink/60">
                            {formatDateTime(session.startedAt)} •{" "}
                            {session.status}
                          </p>
                          <p className="text-[11px] uppercase tracking-wide text-ink/50">
                            {session.transport}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/agent/calls/${session.id}`}
                            className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink/70 transition hover:border-ink/40 hover:text-ink"
                          >
                            Full page
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {callsQuery.isLoading && (
                <p className="text-sm text-ink/60">Loading calls...</p>
              )}
              {!callsQuery.isLoading && groupedCalls.length === 0 ? (
                <p className="text-sm text-ink/60">No calls yet.</p>
              ) : null}
            </div>
          </Card>
        ) : null}

        {activeTab === "tickets" ? (
          <Card className="flex flex-col gap-5 animate-rise">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Open Tickets</h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="rounded-full border border-ink/15 bg-white/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink/70"
                  placeholder="Search tickets"
                  value={ticketSearch}
                  onChange={(event) => setTicketSearch(event.target.value)}
                />
                <select
                  className="rounded-full border border-ink/15 bg-white/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink/70"
                  value={ticketStatus}
                  onChange={(event) =>
                    setTicketStatus(
                      event.target.value as
                        | "open"
                        | "in_progress"
                        | "resolved"
                        | "all",
                    )
                  }
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="all">All</option>
                </select>
                <Button
                  className="bg-clay hover:bg-ink"
                  onClick={() => ticketsQuery.refetch()}
                >
                  Refresh
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              {(ticketsQuery.data?.items ?? []).map((ticket: Ticket) => {
                const callSessionId = ticketCallMap.get(ticket.id);
                return (
                  <div
                    key={ticket.id}
                    className="rounded-2xl border border-ink/10 bg-white/70 p-4"
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
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href={`/agent/tickets/${ticket.id}`}
                        className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink/70 transition hover:border-ink/40 hover:text-ink"
                      >
                        Ticket
                      </Link>
                      {callSessionId ? (
                        <Link
                          href={`/agent/calls/${callSessionId}`}
                          className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink/70 transition hover:border-ink/40 hover:text-ink"
                        >
                          Conversation
                        </Link>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {ticketsQuery.isLoading && (
                <p className="text-sm text-ink/60">Loading tickets...</p>
              )}
              {ticketsQuery.isError && (
                <p className="text-sm text-ink/60">Unable to load tickets.</p>
              )}
              {!ticketsQuery.isLoading &&
              !ticketsQuery.isError &&
              (ticketsQuery.data?.items ?? []).length === 0 ? (
                <p className="text-sm text-ink/60">No open tickets.</p>
              ) : null}
            </div>
          </Card>
        ) : null}

        {activeTab === "appointments" ? (
          <Card className="flex flex-col gap-5 animate-rise">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Appointments</h2>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="bg-moss hover:bg-ink"
                  onClick={() => {
                    setAppointmentsItems([]);
                    setAppointmentsCursor(null);
                    setAppointmentsRefreshKey(Date.now());
                    appointmentsQuery.refetch();
                  }}
                >
                  Refresh
                </Button>
                {appointmentsQuery.data?.nextCursor ? (
                  <Button
                    className="bg-white/80 text-ink hover:bg-ink hover:text-sand"
                    onClick={() =>
                      setAppointmentsCursor(
                        appointmentsQuery.data?.nextCursor ?? null,
                      )
                    }
                  >
                    Load more
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="space-y-3">
              {appointmentsItems.map((appointment: ServiceAppointment) => (
                <div
                  key={appointment.id}
                  className="rounded-2xl border border-ink/10 bg-white/70 p-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-ink">
                      {maskPhone(appointment.phoneE164)}
                    </p>
                    <span className="text-xs uppercase text-ink/50">
                      {appointment.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-ink/60">
                    {appointment.date} • {appointment.timeWindow}
                  </p>
                  {appointment.rescheduledFromId ? (
                    <p className="mt-2 text-xs text-ink/50">
                      Rescheduled from {appointment.rescheduledFromId}
                    </p>
                  ) : null}
                </div>
              ))}
              {appointmentsQuery.isLoading && (
                <p className="text-sm text-ink/60">Loading appointments...</p>
              )}
              {appointmentsQuery.isError && (
                <p className="text-sm text-ink/60">
                  Unable to load appointments.
                </p>
              )}
              {!appointmentsQuery.isLoading &&
              !appointmentsQuery.isError &&
              appointmentsItems.length === 0 ? (
                <p className="text-sm text-ink/60">No appointments yet.</p>
              ) : null}
            </div>
          </Card>
        ) : null}

        {activeTab === "customers" ? (
          <Card className="flex flex-col gap-5 animate-rise">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Customers</h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="rounded-full border border-ink/15 bg-white/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink/70"
                  placeholder="Search customers"
                  value={customerSearch}
                  onChange={(event) => {
                    setCustomersItems([]);
                    setCustomersCursor(null);
                    setCustomerSearch(event.target.value);
                  }}
                />
                <Button
                  className="bg-moss hover:bg-ink"
                  onClick={() => {
                    setCustomersItems([]);
                    setCustomersCursor(null);
                    customersQuery.refetch();
                  }}
                >
                  Refresh
                </Button>
                {customersQuery.data?.nextCursor ? (
                  <Button
                    className="bg-white/80 text-ink hover:bg-ink hover:text-sand"
                    onClick={() =>
                      setCustomersCursor(
                        customersQuery.data?.nextCursor ?? null,
                      )
                    }
                  >
                    Load more
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="space-y-3">
              {customersItems.map((customer) => (
                <div
                  key={customer.id}
                  className="rounded-2xl border border-ink/10 bg-white/70 p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {customer.displayName}
                      </p>
                      <p className="text-xs text-ink/60">
                        {maskPhone(customer.phoneE164)}
                        {customer.addressSummary
                          ? ` • ${customer.addressSummary}`
                          : ""}
                      </p>
                    </div>
                    <Link
                      href={`/agent/customers/${customer.id}`}
                      className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink/70 transition hover:border-ink/40 hover:text-ink"
                    >
                      Open
                    </Link>
                  </div>
                  <p className="mt-2 text-xs text-ink/50">
                    Updated {formatDateTime(customer.updatedAt)}
                  </p>
                </div>
              ))}
              {customersQuery.isLoading && (
                <p className="text-sm text-ink/60">Loading customers...</p>
              )}
              {customersQuery.isError && (
                <p className="text-sm text-ink/60">Unable to load customers.</p>
              )}
              {!customersQuery.isLoading &&
              !customersQuery.isError &&
              customersItems.length === 0 ? (
                <p className="text-sm text-ink/60">No customers yet.</p>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    </main>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge, Button, Card } from "../../components/ui";
import { callRpc } from "../../lib/api";

type CallSession = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  phoneE164: string;
  customerCacheId: string | null;
  status: string;
  transport: string;
  summary: string | null;
};

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
  const [selectedCall, setSelectedCall] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const callsQuery = useQuery({
    queryKey: ["calls"],
    queryFn: () =>
      callRpc<{ items: CallSession[]; nextCursor: string | null }>(
        "calls/list",
        { limit: 20 },
      ),
  });

  const ticketsQuery = useQuery({
    queryKey: ["tickets"],
    queryFn: () =>
      callRpc<{ items: Ticket[]; nextCursor: string | null }>("tickets/list", {
        limit: 12,
      }),
  });

  const groupedCalls = useMemo(() => {
    const map = new Map<
      string,
      { phoneE164: string; sessions: CallSession[] }
    >();
    for (const session of callsQuery.data?.items ?? []) {
      const key = session.phoneE164;
      const existing = map.get(key);
      if (existing) {
        existing.sessions.push(session);
      } else {
        map.set(key, { phoneE164: key, sessions: [session] });
      }
    }
    return Array.from(map.values()).map((entry) => {
      const sorted = entry.sessions.sort((a, b) =>
        a.startedAt < b.startedAt ? 1 : -1,
      );
      return {
        phoneE164: entry.phoneE164,
        count: entry.sessions.length,
        latest: sorted[0],
      };
    });
  }, [callsQuery.data?.items]);
  const copyCallJson = async () => {
    if (!selectedCall) {
      return;
    }
    await navigator.clipboard.writeText(
      JSON.stringify({ callSessionId: selectedCall }, null, 2),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main className="grid-dots min-h-screen px-6 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4">
          <Badge className="w-fit">Agent Dashboard</Badge>
          <h1 className="text-3xl font-semibold text-ink sm:text-4xl">
            Calls, tickets, and live traces in one place.
          </h1>
          <p className="max-w-3xl text-ink/70">
            Review recent sessions, monitor ticket status, and inspect model +
            tool usage per turn.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <Card className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Recent Calls</h2>
              <Button
                className="bg-moss hover:bg-ink"
                onClick={() => callsQuery.refetch()}
              >
                Refresh
              </Button>
            </div>
            <div className="space-y-3">
              {groupedCalls.map((group) =>
                group.latest ? (
                  <div
                    key={group.phoneE164}
                    className="rounded-2xl border border-ink/10 bg-white/70 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-ink">
                          {maskPhone(group.phoneE164)}
                        </p>
                        <p className="text-xs text-ink/60">
                          {formatDateTime(group.latest.startedAt)} •{" "}
                          {group.latest.status} • {group.count} sessions
                        </p>
                      </div>
                      <span className="text-xs uppercase tracking-wide text-ink/50">
                        {group.latest.transport}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className="bg-moss hover:bg-ink"
                        onClick={() =>
                          setSelectedCall(group.latest?.id ?? null)
                        }
                      >
                        View trace
                      </Button>
                      <Link
                        href={`/agent/calls/${group.latest.id}`}
                        className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink/70 transition hover:border-ink/40 hover:text-ink"
                      >
                        Full page
                      </Link>
                    </div>
                  </div>
                ) : null,
              )}
              {callsQuery.isLoading && (
                <p className="text-sm text-ink/60">Loading calls...</p>
              )}
            </div>
          </Card>

          <Card className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Open Tickets</h2>
              <Button
                className="bg-clay hover:bg-ink"
                onClick={() => ticketsQuery.refetch()}
              >
                Refresh
              </Button>
            </div>
            <div className="space-y-3">
              {(ticketsQuery.data?.items ?? []).map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/agent/tickets/${ticket.id}`}
                  className="block rounded-2xl border border-ink/10 bg-white/70 p-4 transition hover:border-ink/30"
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
                </Link>
              ))}
              {ticketsQuery.isLoading && (
                <p className="text-sm text-ink/60">Loading tickets...</p>
              )}
            </div>
          </Card>
        </div>

        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Call Trace</h2>
              <p className="text-xs uppercase tracking-wide text-ink/50">
                {selectedCall ? `Session ${selectedCall}` : "Select a call"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge className="bg-white/80">Context + Tools</Badge>
              {selectedCall ? (
                <button
                  type="button"
                  onClick={copyCallJson}
                  className="text-xs font-semibold uppercase tracking-wide text-ink/50 hover:text-ink"
                >
                  {copied ? "Copied" : "Copy JSON"}
                </button>
              ) : null}
            </div>
          </div>
          {selectedCall ? (
            <div className="rounded-2xl border border-ink/10 bg-white/80 p-4 text-sm text-ink/70">
              <p>
                Use the full call page for the transcript and tool details.{" "}
                <Link
                  href={`/agent/calls/${selectedCall}`}
                  className="font-semibold text-ink underline"
                >
                  Open full call view →
                </Link>
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink/60">
              Select a call to inspect the transcript, tool calls, and model
              activity.
            </p>
          )}
        </Card>
      </div>
    </main>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
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

type CallTurn = {
  id: string;
  callSessionId: string;
  ts: string;
  speaker: string;
  text: string;
  meta: {
    tools?: unknown[];
    modelCalls?: unknown[];
    [key: string]: unknown;
  };
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

  const callDetailQuery = useQuery({
    queryKey: ["call-detail", selectedCall],
    queryFn: () =>
      callRpc<{ session: CallSession; turns: CallTurn[] }>("calls/get", {
        callSessionId: selectedCall,
      }),
    enabled: Boolean(selectedCall),
  });

  const callDetail = callDetailQuery.data?.turns ?? [];
  const callTrace = useMemo(() => {
    return callDetail.map((turn) => ({
      ...turn,
      toolCount: Array.isArray(turn.meta.tools)
        ? (turn.meta.tools as Array<unknown>).length
        : 0,
      modelCount: Array.isArray(turn.meta.modelCalls)
        ? (turn.meta.modelCalls as Array<unknown>).length
        : 0,
    }));
  }, [callDetail]);

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
              {(callsQuery.data?.items ?? []).map((call) => (
                <button
                  key={call.id}
                  type="button"
                  onClick={() => setSelectedCall(call.id)}
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                    selectedCall === call.id
                      ? "border-ink/30 bg-ink/5"
                      : "border-ink/10 bg-white/70 hover:border-ink/20"
                  }`}
                >
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {maskPhone(call.phoneE164)}
                    </p>
                    <p className="text-xs text-ink/60">
                      {formatDateTime(call.startedAt)} • {call.status}
                    </p>
                  </div>
                  <span className="text-xs uppercase tracking-wide text-ink/50">
                    {call.transport}
                  </span>
                </button>
              ))}
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
                </div>
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
            <Badge className="bg-white/80">Context + Tools</Badge>
          </div>
          {selectedCall ? (
            <div className="space-y-3">
              {callTrace.map((turn) => (
                <div
                  key={turn.id}
                  className="rounded-2xl border border-ink/10 bg-white/80 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs uppercase tracking-wide text-ink/60">
                      {turn.speaker} • {formatDateTime(turn.ts)}
                    </span>
                    <span className="text-xs text-ink/50">
                      {turn.toolCount} tools • {turn.modelCount} model calls
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-ink">{turn.text}</p>
                </div>
              ))}
              {callDetailQuery.isLoading && (
                <p className="text-sm text-ink/60">Loading call trace...</p>
              )}
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

"use client";

import type {
  AgentPromptConfigRecord,
  ServiceAppointment,
  Ticket,
} from "@pestcall/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { CallSession } from "@pestcall/core";

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
  const [selectedCall, setSelectedCall] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [configDraft, setConfigDraft] =
    useState<AgentPromptConfigRecord | null>(null);
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();
  const modelOptions = [
    "@cf/meta/llama-3.1-8b-instruct",
    "@cf/meta/llama-3.1-70b-instruct",
    "@cf/mistral/mistral-7b-instruct-v0.2",
  ];

  const callsQuery = useQuery({
    queryKey: ["calls"],
    queryFn: () => rpcClient.calls.list({ limit: 20 }),
  });

  const ticketsQuery = useQuery({
    queryKey: ["tickets"],
    queryFn: () => rpcClient.tickets.list({ limit: 12 }),
  });

  const appointmentsQuery = useQuery({
    queryKey: ["appointments"],
    queryFn: () => rpcClient.appointments.list({ limit: 10 }),
  });

  const agentConfigQuery = useQuery({
    queryKey: ["agent-config"],
    queryFn: () => rpcClient.agentConfig.get(),
  });

  useEffect(() => {
    if (!configDraft && agentConfigQuery.data) {
      setConfigDraft(agentConfigQuery.data);
    }
  }, [agentConfigQuery.data, configDraft]);

  const updateConfig = useMutation({
    mutationFn: (input: AgentPromptConfigRecord) => {
      const { updatedAt, ...payload } = input;
      return rpcClient.agentConfig.update(payload);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["agent-config"], data);
      setConfigDraft(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    },
  });

  const handleConfigChange = (
    field: keyof AgentPromptConfigRecord,
    value: string,
  ) => {
    setConfigDraft((prev: AgentPromptConfigRecord | null) =>
      prev ? { ...prev, [field]: value } : prev,
    );
  };

  const handleToolGuidanceChange = (
    field: keyof AgentPromptConfigRecord["toolGuidance"],
    value: string,
  ) => {
    setConfigDraft((prev: AgentPromptConfigRecord | null) =>
      prev
        ? {
            ...prev,
            toolGuidance: {
              ...prev.toolGuidance,
              [field]: value,
            },
          }
        : prev,
    );
  };

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
    for (const session of callsQuery.data?.items ?? []) {
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
    return Array.from(map.values()).map((entry) => {
      const sorted = entry.sessions.sort((a, b) =>
        a.startedAt < b.startedAt ? 1 : -1,
      );
      return {
        ...entry,
        sessions: sorted,
        count: sorted.length,
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
            The <span className="accent-text">PestCall</span> operations hub.
          </h1>
          <p className="max-w-3xl text-ink/70">
            Track call sessions, inspect model/tool behavior, and manage tickets
            without leaving the command center.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <Card className="flex flex-col gap-5 animate-rise">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Calls by Customer</h2>
              <Button
                className="bg-moss hover:bg-ink"
                onClick={() => callsQuery.refetch()}
              >
                Refresh
              </Button>
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
                          <Button
                            type="button"
                            className="bg-moss hover:bg-ink"
                            onClick={() => setSelectedCall(session.id)}
                          >
                            View trace
                          </Button>
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
            </div>
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="flex flex-col gap-5 animate-rise">
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
                {(ticketsQuery.data?.items ?? []).map((ticket: Ticket) => (
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

            <Card className="flex flex-col gap-5 animate-rise">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Appointments</h2>
                <Button
                  className="bg-moss hover:bg-ink"
                  onClick={() => appointmentsQuery.refetch()}
                >
                  Refresh
                </Button>
              </div>
              <div className="space-y-3">
                {(appointmentsQuery.data?.items ?? []).map(
                  (appointment: ServiceAppointment) => (
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
                  ),
                )}
                {appointmentsQuery.isLoading && (
                  <p className="text-sm text-ink/60">Loading appointments...</p>
                )}
              </div>
            </Card>

            <Card className="flex flex-col gap-5 animate-rise">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Prompt Studio</h2>
                  <p className="text-xs uppercase tracking-wide text-ink/50">
                    Live edits, no deploys
                  </p>
                </div>
                <Button
                  className="bg-ink hover:bg-slate"
                  disabled={!configDraft || updateConfig.isPending}
                  onClick={() => {
                    if (configDraft) {
                      updateConfig.mutate(configDraft);
                    }
                  }}
                >
                  {updateConfig.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
              {saved ? (
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">
                  Saved
                </p>
              ) : null}
              {configDraft ? (
                <div className="space-y-4 text-sm">
                  <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                    Tone
                    <select
                      className="rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                      value={configDraft.tone}
                      onChange={(event) =>
                        handleConfigChange("tone", event.target.value)
                      }
                    >
                      <option value="warm">Warm</option>
                      <option value="neutral">Neutral</option>
                      <option value="direct">Direct</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                    Company Name
                    <input
                      className="rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                      value={configDraft.companyName}
                      onChange={(event) =>
                        handleConfigChange("companyName", event.target.value)
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                    Greeting
                    <textarea
                      className="min-h-[80px] rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                      value={configDraft.greeting}
                      onChange={(event) =>
                        handleConfigChange("greeting", event.target.value)
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                    Scope Message
                    <textarea
                      className="min-h-[80px] rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                      value={configDraft.scopeMessage}
                      onChange={(event) =>
                        handleConfigChange("scopeMessage", event.target.value)
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                    Persona Summary
                    <textarea
                      className="min-h-[120px] rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                      value={configDraft.personaSummary}
                      onChange={(event) =>
                        handleConfigChange("personaSummary", event.target.value)
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                    Tool Guidance: Next Appointment
                    <textarea
                      className="min-h-[90px] rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                      value={configDraft.toolGuidance.getNextAppointment}
                      onChange={(event) =>
                        handleToolGuidanceChange(
                          "getNextAppointment",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                    Tool Guidance: Open Invoices
                    <textarea
                      className="min-h-[90px] rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                      value={configDraft.toolGuidance.getOpenInvoices}
                      onChange={(event) =>
                        handleToolGuidanceChange(
                          "getOpenInvoices",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                    Tool Guidance: Reschedule
                    <textarea
                      className="min-h-[90px] rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                      value={configDraft.toolGuidance.rescheduleAppointment}
                      onChange={(event) =>
                        handleToolGuidanceChange(
                          "rescheduleAppointment",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                    Tool Guidance: Escalation
                    <textarea
                      className="min-h-[90px] rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                      value={configDraft.toolGuidance.escalate}
                      onChange={(event) =>
                        handleToolGuidanceChange("escalate", event.target.value)
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-ink/60">
                    Model ID
                    <select
                      className="rounded-2xl border border-ink/15 bg-white/80 px-3 py-2 text-sm text-ink shadow-soft"
                      value={configDraft.modelId}
                      onChange={(event) =>
                        handleConfigChange("modelId", event.target.value)
                      }
                    >
                      {modelOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : (
                <p className="text-sm text-ink/60">Loading prompt config...</p>
              )}
            </Card>
          </div>
        </div>

        <Card className="flex flex-col gap-4 animate-rise">
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

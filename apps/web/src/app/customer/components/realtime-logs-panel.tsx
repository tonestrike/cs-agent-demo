"use client";

import { useMemo, useState } from "react";

import type { ClientLog, TurnMetric } from "../types";

type RealtimeLogsPanelProps = {
  logs: ClientLog[];
  turnMetrics: TurnMetric[];
  callSessionId: string | null;
  phoneNumber: string;
  status: string;
  onCopyConversation: () => void | Promise<void>;
};

function formatMs(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toLocaleString()} ms`;
}

function buildSummary({
  callSessionId,
  phoneNumber,
  status,
  logs,
  turnMetrics,
}: {
  callSessionId: string | null;
  phoneNumber: string;
  status: string;
  logs: ClientLog[];
  turnMetrics: TurnMetric[];
}): string {
  const errorLogs = logs.filter(
    (entry) =>
      entry.level === "error" || /error|failed|issue/i.test(entry.message),
  );
  const warnLogs = logs.filter(
    (entry) => entry.level === "warn" || /timeout|retry/i.test(entry.message),
  );
  const rpcTrail = logs
    .filter(
      (entry) => entry.message.startsWith("rpc.") || entry.source === "rpc",
    )
    .slice(-6)
    .map((entry) => entry.message)
    .join(" -> ");
  const latestTurn = turnMetrics.at(-1);
  const turnLine = latestTurn
    ? `Turn ${latestTurn.turnId}: first status ${formatMs(latestTurn.firstStatusMs)}, first token ${formatMs(latestTurn.firstTokenMs)}, final ${formatMs(latestTurn.totalMs)}`
    : "Turn metrics unavailable";
  const toolMentions = turnMetrics
    .flatMap((turn) => turn.statusTexts)
    .filter((text) => /tool|function|call/i.test(text))
    .slice(-4);

  return [
    `Session: ${callSessionId ?? "pending"} (${phoneNumber})`,
    `Status: ${status}`,
    `Events: ${logs.length} total, ${errorLogs.length} errors, ${warnLogs.length} warnings`,
    rpcTrail ? `RPC path: ${rpcTrail}` : "RPC path: none recorded yet",
    turnLine,
    toolMentions.length
      ? `Tool hints: ${toolMentions.join(" | ")}`
      : "Tool hints: none observed in status stream",
  ].join("\n");
}

function buildTimeline(logs: ClientLog[]): string {
  const sorted = [...logs].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return sorted
    .map((entry) => {
      const label = `[${entry.level ?? "info"}:${entry.source ?? "client"}]`;
      const dataPreview = entry.data
        ? ` ${JSON.stringify(entry.data).slice(0, 220)}`
        : "";
      return `${entry.ts} ${label} ${entry.message}${dataPreview}`;
    })
    .join("\n");
}

export function RealtimeLogsPanel({
  logs,
  turnMetrics,
  callSessionId,
  phoneNumber,
  status,
  onCopyConversation,
}: RealtimeLogsPanelProps) {
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [copiedTimeline, setCopiedTimeline] = useState(false);

  const sortedLogs = useMemo(
    () =>
      [...logs]
        .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
        .slice(0, 60),
    [logs],
  );
  const summary = useMemo(
    () =>
      buildSummary({
        callSessionId,
        phoneNumber,
        status,
        logs,
        turnMetrics,
      }),
    [callSessionId, logs, phoneNumber, status, turnMetrics],
  );
  const timelineText = useMemo(() => buildTimeline(logs), [logs]);
  const rawPayload = useMemo(
    () =>
      JSON.stringify(
        { callSessionId, phoneNumber, status, logs, turnMetrics },
        null,
        2,
      ),
    [callSessionId, logs, phoneNumber, status, turnMetrics],
  );

  const issueSignals = useMemo(() => {
    const errors = sortedLogs.filter((entry) => entry.level === "error");
    if (errors.length > 0) {
      return errors.slice(0, 3);
    }
    const warnings = sortedLogs.filter((entry) => entry.level === "warn");
    return warnings.slice(0, 3);
  }, [sortedLogs]);

  const recentTurns = useMemo(
    () => [...turnMetrics].sort((a, b) => b.turnId - a.turnId).slice(0, 4),
    [turnMetrics],
  );

  const copySummary = async () => {
    await navigator.clipboard.writeText(summary);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 1800);
  };

  const copyRaw = async () => {
    await navigator.clipboard.writeText(rawPayload);
    setCopiedRaw(true);
    setTimeout(() => setCopiedRaw(false), 1800);
  };

  const copyTimeline = async () => {
    await navigator.clipboard.writeText(timelineText);
    setCopiedTimeline(true);
    setTimeout(() => setCopiedTimeline(false), 1800);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Debug snapshot
            </p>
            <p className="text-sm text-ink-700">
              Session {callSessionId ?? "pending"} — {status}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copySummary}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                copiedSummary
                  ? "bg-moss-100 text-moss-700"
                  : "bg-ink text-white hover:bg-ink-800"
              }`}
            >
              {copiedSummary ? "Summary copied" : "Copy summary"}
            </button>
            <button
              type="button"
              onClick={copyTimeline}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                copiedTimeline
                  ? "border-moss-300 bg-moss-100 text-moss-700"
                  : "border-ink-200 bg-white text-ink-700 hover:bg-sand-100"
              }`}
            >
              {copiedTimeline ? "Timeline copied" : "Copy timeline"}
            </button>
            <button
              type="button"
              onClick={copyRaw}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                copiedRaw
                  ? "border-moss-300 bg-moss-100 text-moss-700"
                  : "border-ink-200 bg-white text-ink-700 hover:bg-sand-100"
              }`}
            >
              {copiedRaw ? "Bundle copied" : "Copy debug bundle"}
            </button>
            <button
              type="button"
              onClick={onCopyConversation}
              className="rounded-lg border border-ink-200 bg-sand-100 px-3 py-2 text-xs font-semibold text-ink-700 transition hover:bg-sand-200"
            >
              Copy with messages
            </button>
          </div>
        </div>
        <pre className="mt-3 max-h-44 overflow-y-auto rounded-lg bg-sand-50 p-3 text-[11px] leading-relaxed text-ink-700">
          {summary}
        </pre>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">Issues & signals</p>
            <span className="rounded-full bg-sand-100 px-2 py-1 text-[11px] font-semibold text-ink-600">
              {logs.length} events
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {issueSignals.length === 0 ? (
              <p className="text-xs text-ink-400">No warnings or errors yet.</p>
            ) : (
              issueSignals.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-ink-100 bg-sand-50 p-2"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[11px] font-semibold uppercase ${
                        entry.level === "error"
                          ? "text-amber-700"
                          : "text-ink-500"
                      }`}
                    >
                      {entry.level ?? "info"}
                    </span>
                    <span className="font-mono text-[11px] text-ink-400">
                      {entry.ts.slice(11, 19)}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-ink-700">
                    {entry.message}
                  </p>
                  {entry.data && (
                    <pre className="mt-1 overflow-x-auto rounded bg-white p-2 text-[11px] text-ink-600">
                      {JSON.stringify(entry.data, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">Latency tracker</p>
            <span className="text-[11px] font-semibold uppercase text-ink-400">
              Most recent turns
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {recentTurns.length === 0 ? (
              <p className="text-xs text-ink-400">No turns recorded yet.</p>
            ) : (
              recentTurns.map((turn) => (
                <div
                  key={turn.turnId}
                  className="rounded-lg border border-ink-100 bg-sand-50 p-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-ink">
                      Turn {turn.turnId}
                    </p>
                    <span className="font-mono text-[11px] text-ink-500">
                      {turn.sessionId.slice(0, 8)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-500">
                    {turn.userText ? turn.userText.slice(0, 80) : "System"}
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-semibold text-ink-600">
                    <span>First status: {formatMs(turn.firstStatusMs)}</span>
                    <span>First token: {formatMs(turn.firstTokenMs)}</span>
                    <span>Final: {formatMs(turn.totalMs)}</span>
                  </div>
                  {turn.statusTexts.length > 0 && (
                    <p className="mt-2 text-[11px] text-ink-500">
                      Status stream:{" "}
                      {turn.statusTexts.slice(-3).join(" | ").slice(0, 140)}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-soft">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">Event timeline</p>
          <span className="text-[11px] text-ink-400">
            Showing latest {sortedLogs.length} events
          </span>
        </div>
        <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {sortedLogs.length === 0 ? (
            <p className="text-xs text-ink-400">Waiting for realtime events.</p>
          ) : (
            sortedLogs.map((entry) => (
              <div
                key={entry.id}
                className="flex gap-3 rounded-lg border border-ink-100 bg-sand-50 p-2 text-sm"
              >
                <span className="font-mono text-[11px] text-ink-400">
                  {entry.ts.slice(11, 19)}
                </span>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-ink-600">
                      {entry.level ?? "info"}
                    </span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-ink-500">
                      {entry.source ?? "client"}
                    </span>
                    <span className="font-semibold text-ink-800">
                      {entry.message}
                    </span>
                  </div>
                  {entry.data && (
                    <pre className="mt-1 overflow-x-auto rounded bg-white p-2 text-[11px] text-ink-600">
                      {JSON.stringify(entry.data, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

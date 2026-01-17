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

type HealthFinding = {
  id: string;
  severity: "critical" | "warn" | "info";
  title: string;
  detail: string;
  evidence?: string;
};

type HealthAnalysis = {
  findings: HealthFinding[];
  statusTrail: Array<{ text: string; turnId: number }>;
  headline: string;
  interpretationErrors: number;
  emptyPayloads: number;
  emptyTurns: number;
  slowTurns: number;
};

function formatMs(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toLocaleString()} ms`;
}

function summarizeData(
  data: Record<string, unknown> | undefined,
  maxItems = 6,
): string[] {
  if (!data) return [];
  return Object.entries(data)
    .slice(0, maxItems)
    .map(([key, value]) => {
      if (value === null || value === undefined) return `${key}: —`;
      if (typeof value === "string") return `${key}: ${value.slice(0, 48)}`;
      if (typeof value === "number" || typeof value === "boolean") {
        return `${key}: ${String(value)}`;
      }
      return `${key}: ${JSON.stringify(value).slice(0, 48)}`;
    });
}

function readNumberField(
  data: Record<string, unknown> | undefined,
  key: string,
): number | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}

function readStringField(
  data: Record<string, unknown> | undefined,
  key: string,
): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function buildSummary({
  callSessionId,
  phoneNumber,
  status,
  logs,
  turnMetrics,
  health,
}: {
  callSessionId: string | null;
  phoneNumber: string;
  status: string;
  logs: ClientLog[];
  turnMetrics: TurnMetric[];
  health: HealthAnalysis;
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
    `Health: ${health.headline}`,
    `Detected: ${health.emptyTurns} empty turns, ${health.interpretationErrors} interpretation issues, ${health.emptyPayloads} empty payloads`,
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
      const contextPreview = entry.contextMessages
        ? ` ctx=${entry.contextMessages
            .map((msg) => `${msg.role}:${msg.text.slice(0, 60)}`)
            .join(" | ")}`
        : "";
      return `${entry.ts} ${label} ${entry.message}${dataPreview}${contextPreview}`;
    })
    .join("\n");
}

function analyzeHealth({
  logs,
  turnMetrics,
}: {
  logs: ClientLog[];
  turnMetrics: TurnMetric[];
}): HealthAnalysis {
  const statusTrail = turnMetrics.flatMap((turn) =>
    turn.statusTexts.map((text) => ({ text, turnId: turn.turnId })),
  );
  const emptyPayloads = logs.filter((entry) => {
    const length = readNumberField(entry.data, "textLength");
    const type = readStringField(entry.data, "type") ?? entry.message;
    return length === 0 && /ws|socket|message/.test(String(type));
  });
  const emptyTurns = turnMetrics.filter((turn) => turn.userTextLength === 0);
  const interpretationStatuses = statusTrail.filter((item) =>
    /did not interpret|could not interpret|did not understand|didn't interpret|didn't catch|no speech/i.test(
      item.text,
    ),
  );
  const slowTurns = turnMetrics.filter(
    (turn) => (turn.firstTokenMs ?? 0) > 4000,
  );
  const missingFinals = turnMetrics.filter(
    (turn) => turn.totalMs === null && turn.firstTokenAt !== null,
  );

  const findings: HealthFinding[] = [];
  if (emptyTurns.length > 0) {
    findings.push({
      id: "empty-turns",
      severity: "critical",
      title: "Empty customer message captured",
      detail: `${emptyTurns.length} turn(s) had no transcript text. This often leads to "I did not interpret your request".`,
      evidence: `Turns: ${emptyTurns.map((t) => t.turnId).join(", ")}`,
    });
  }
  if (emptyPayloads.length > 0) {
    findings.push({
      id: "empty-payloads",
      severity: "critical",
      title: "Zero-length websocket payloads",
      detail:
        "Realtime stream delivered empty payloads; check audio input, browser mic permissions, or customer silence.",
      evidence: `${emptyPayloads.length} empty payload(s) from socket`,
    });
  }
  if (interpretationStatuses.length > 0) {
    findings.push({
      id: "interpretation",
      severity: "critical",
      title: "Assistant could not interpret",
      detail: `${interpretationStatuses.length} status message(s) mention interpretation failures. Trace the status stream below.`,
    });
  }
  if (slowTurns.length > 0) {
    findings.push({
      id: "slow-turns",
      severity: "warn",
      title: "Slow first tokens",
      detail: `${slowTurns.length} turn(s) exceeded 4s to first token. Consider backend latency or tool calls.`,
      evidence: `Turns: ${slowTurns.map((t) => t.turnId).join(", ")}`,
    });
  }
  if (missingFinals.length > 0) {
    findings.push({
      id: "missing-final",
      severity: "warn",
      title: "Turns missing final completions",
      detail: `${missingFinals.length} turn(s) streamed tokens but never marked final.`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "healthy",
      severity: "info",
      title: "Healthy conversation so far",
      detail:
        "No empty messages or interpretation errors detected. Latency within expected range.",
    });
  }

  const headline =
    findings.find((item) => item.severity !== "info")?.title ??
    "Healthy conversation baseline";

  return {
    findings,
    statusTrail: statusTrail.slice(-16),
    headline,
    interpretationErrors: interpretationStatuses.length,
    emptyPayloads: emptyPayloads.length,
    emptyTurns: emptyTurns.length,
    slowTurns: slowTurns.length,
  };
}

function buildHealthDigest(health: HealthAnalysis, summary: string): string {
  const findingLines = health.findings
    .slice(0, 4)
    .map(
      (item, index) =>
        `${index + 1}. [${item.severity}] ${item.title} — ${item.detail}`,
    )
    .join("\n");
  const statusLine =
    health.statusTrail.length > 0
      ? `Recent statuses: ${health.statusTrail
          .map((item) => `T${item.turnId}: ${item.text}`)
          .join(" | ")}`
      : "Recent statuses: none yet.";

  return [
    `Conversation health: ${health.headline}`,
    findingLines || "No findings recorded.",
    statusLine,
    "Snapshot:",
    summary,
  ].join("\n\n");
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
  const [copiedHealth, setCopiedHealth] = useState(false);

  const healthAnalysis = useMemo(
    () => analyzeHealth({ logs, turnMetrics }),
    [logs, turnMetrics],
  );

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
        health: healthAnalysis,
      }),
    [callSessionId, healthAnalysis, logs, phoneNumber, status, turnMetrics],
  );
  const timelineText = useMemo(() => buildTimeline(logs), [logs]);
  const healthDigest = useMemo(
    () => buildHealthDigest(healthAnalysis, summary),
    [healthAnalysis, summary],
  );
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

  const copyHealth = async () => {
    await navigator.clipboard.writeText(healthDigest);
    setCopiedHealth(true);
    setTimeout(() => setCopiedHealth(false), 1800);
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

  const severityStyles: Record<HealthFinding["severity"], string> = {
    critical: "border-amber-200 bg-amber-50 text-amber-800",
    warn: "border-sand-200 bg-sand-50 text-ink-800",
    info: "border-moss-200 bg-moss-50 text-ink-800",
  };

  const goodConversationTraits = [
    "Customer speech is captured (text length > 0) before any status that says a request was interpreted.",
    "Status stream shows verification/tool steps followed by first token < 3s and a final status.",
    "Assistant responses avoid filler like “I did not interpret your request” and include tool or action context.",
  ];

  const pitfalls = [
    "Empty websocket payloads or blank transcripts turn into “I did not interpret your request.”",
    "Long gaps (>4s) before first token often mean backend/tool latency; check recent statuses.",
    "Missing final messages can hide failures—ensure every turn ends with a final status.",
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              Realtime debug snapshot
            </p>
            <p className="text-base font-semibold text-ink-800">
              Session {callSessionId ?? "pending"} — {status}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full bg-sand-100 px-2 py-1 font-semibold text-ink-700">
                {logs.length} events
              </span>
              <span className="rounded-full bg-sand-100 px-2 py-1 font-semibold text-ink-700">
                {turnMetrics.length} turns
              </span>
              <span className="rounded-full bg-sand-100 px-2 py-1 font-semibold text-ink-700">
                Health: {healthAnalysis.headline}
              </span>
            </div>
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
              onClick={copyHealth}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                copiedHealth
                  ? "border-moss-300 bg-moss-100 text-moss-700"
                  : "border-ink-200 bg-white text-ink-700 hover:bg-sand-100"
              }`}
            >
              {copiedHealth ? "Health copied" : "Copy health digest"}
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

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 rounded-2xl border border-ink-200 bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-ink">
                Conversation health
              </p>
              <p className="text-xs text-ink-500">
                Highlights the fastest path to a good conversation vs. risky
                patterns.
              </p>
            </div>
            <span className="rounded-full bg-sand-100 px-3 py-1 text-[11px] font-semibold text-ink-700">
              {healthAnalysis.findings.length} findings
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {healthAnalysis.findings.map((finding) => (
              <div
                key={finding.id}
                className={`rounded-xl border p-3 text-sm ${severityStyles[finding.severity]}`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-ink-900">{finding.title}</p>
                  <span className="rounded-full border border-white/60 bg-white/60 px-2 py-0.5 text-[11px] font-semibold uppercase text-ink-700">
                    {finding.severity}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-ink-800">
                  {finding.detail}
                </p>
                {finding.evidence && (
                  <p className="mt-1 text-[11px] text-ink-600">
                    Evidence: {finding.evidence}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-ink-100 bg-sand-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                What good looks like
              </p>
              <ul className="mt-2 space-y-2 text-sm text-ink-800">
                {goodConversationTraits.map((item) => (
                  <li key={item} className="leading-snug">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                Common pitfalls to spot fast
              </p>
              <ul className="mt-2 space-y-2 text-sm text-amber-900">
                {pitfalls.map((item) => (
                  <li key={item} className="leading-snug">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">
              Status stream trace
            </p>
            <span className="text-[11px] text-ink-500">
              {healthAnalysis.statusTrail.length} recent
            </span>
          </div>
          <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto">
            {healthAnalysis.statusTrail.length === 0 ? (
              <p className="text-xs text-ink-400">No status messages yet.</p>
            ) : (
              healthAnalysis.statusTrail.map((item, index) => (
                <div
                  key={`${item.turnId}-${index}-${item.text}`}
                  className="flex items-start gap-3 rounded-xl border border-ink-100 bg-sand-50 p-2"
                >
                  <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-ink-700">
                    Turn {item.turnId}
                  </span>
                  <p className="flex-1 text-sm text-ink-800">{item.text}</p>
                </div>
              ))
            )}
          </div>
          <p className="mt-3 text-[11px] text-ink-500">
            Watch for empty statuses or “did not interpret your request” to
            trace how a blank transcript surfaced. Pair this with the event
            timeline below.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-soft">
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

        <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-soft">
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
          {healthAnalysis.slowTurns > 0 && (
            <p className="mt-2 text-[11px] text-amber-800">
              {healthAnalysis.slowTurns} slow turn(s) over 4s to first token.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-soft">
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
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-ink-700">
                      {entry.level ?? "info"}
                    </span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-ink-600">
                      {entry.source ?? "client"}
                    </span>
                    <span className="rounded bg-ink text-[11px] font-semibold uppercase text-white px-2 py-0.5">
                      Message
                    </span>
                    <span className="font-semibold text-ink-900">
                      {entry.message}
                    </span>
                  </div>
                  {summarizeData(entry.data).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-ink-700">
                      {summarizeData(entry.data).map((item) => (
                        <span
                          key={item}
                          className="rounded-full bg-white px-2 py-1 font-mono"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                  {entry.data && (
                    <details className="mt-1 rounded-lg border border-ink-100 bg-white/70 p-2 text-[11px] text-ink-700">
                      <summary className="cursor-pointer font-semibold text-ink-800">
                        Full payload
                      </summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-white p-2 text-[11px] text-ink-700">
                        {JSON.stringify(entry.data, null, 2)}
                      </pre>
                    </details>
                  )}
                  {entry.contextMessages &&
                    entry.contextMessages.length > 0 && (
                      <div className="mt-2 rounded-lg border border-ink-100 bg-white/70 p-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                          Conversation context captured
                        </p>
                        <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
                          {entry.contextMessages.map((msg) => (
                            <div
                              key={`${msg.id}-${msg.role}`}
                              className="flex items-start gap-2 text-[12px]"
                            >
                              <span className="rounded bg-sand-100 px-2 py-0.5 font-semibold text-ink-700">
                                {msg.role}
                              </span>
                              <p className="flex-1 text-ink-800">{msg.text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
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

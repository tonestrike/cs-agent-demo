"use client";

import { useState } from "react";
import { apiBaseUrl, demoAuthToken } from "../../../lib/env";
import type { ClientLog } from "../types";

type ClientLogsPanelProps = {
  logs: ClientLog[];
  callSessionId: string | null;
  phoneNumber: string;
  onCopyConversation: () => void;
};

export function ClientLogsPanel({
  logs,
  callSessionId,
  phoneNumber,
  onCopyConversation,
}: ClientLogsPanelProps) {
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [copiedConvo, setCopiedConvo] = useState(false);
  const [summaryMarkdown, setSummaryMarkdown] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const copyLogs = async () => {
    const payload = { callSessionId, phoneNumber, logs };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  const handleCopyConversation = async () => {
    await onCopyConversation();
    setCopiedConvo(true);
    setTimeout(() => setCopiedConvo(false), 2000);
  };

  const fetchSummary = async () => {
    if (!callSessionId || summaryLoading) {
      return;
    }
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const base = apiBaseUrl || window.location.origin;
      const url = new URL(`/api/conversations/${callSessionId}/summary`, base);
      const response = await fetch(url, {
        method: "GET",
        headers: demoAuthToken ? { "x-demo-auth": demoAuthToken } : undefined,
      });
      if (!response.ok) {
        throw new Error("Summary request failed");
      }
      const payload = (await response.json()) as {
        summary?: string;
      };
      setSummaryMarkdown(payload.summary ?? null);
    } catch (error) {
      setSummaryError(
        error instanceof Error ? error.message : "Summary request failed",
      );
    } finally {
      setSummaryLoading(false);
    }
  };

  const copySummary = async () => {
    if (!summaryMarkdown) {
      return;
    }
    await navigator.clipboard.writeText(summaryMarkdown);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header with copy buttons */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copyLogs}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            copiedLogs
              ? "bg-moss-100 text-moss-700"
              : "bg-ink text-white hover:bg-ink-800"
          }`}
        >
          {copiedLogs ? "Copied!" : "Copy Logs"}
        </button>
        <button
          type="button"
          onClick={handleCopyConversation}
          className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
            copiedConvo
              ? "border-moss-300 bg-moss-100 text-moss-700"
              : "border-ink-200 bg-white text-ink-700 hover:bg-sand-100"
          }`}
        >
          {copiedConvo ? "Copied!" : "Copy Conversation"}
        </button>
      </div>

      {/* Session info */}
      {callSessionId && (
        <div className="mb-4 rounded-lg bg-sand-200 p-3">
          <p className="text-xs font-medium text-ink-500">Session ID</p>
          <p className="mt-1 font-mono text-sm text-ink">{callSessionId}</p>
        </div>
      )}

      {/* Summary */}
      <div className="mb-4 rounded-lg border border-ink-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={fetchSummary}
            disabled={!callSessionId || summaryLoading}
            className="rounded-lg border border-ink-200 bg-sand-100 px-3 py-2 text-xs font-semibold text-ink-700 transition hover:bg-sand-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {summaryLoading ? "Loading summary…" : "Load Summary"}
          </button>
          <button
            type="button"
            onClick={copySummary}
            disabled={!summaryMarkdown}
            className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-700 transition hover:bg-sand-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Copy Summary
          </button>
        </div>
        {summaryError && (
          <p className="mt-2 text-xs text-amber-700">{summaryError}</p>
        )}
        {summaryMarkdown ? (
          <pre className="mt-3 max-h-64 overflow-y-auto rounded bg-sand-50 p-3 text-xs text-ink-700">
            {summaryMarkdown}
          </pre>
        ) : (
          <p className="mt-3 text-xs text-ink-400">
            Generate a markdown summary of this conversation.
          </p>
        )}
      </div>

      {/* Logs list */}
      <div className="flex-1 overflow-y-auto rounded-lg border border-ink-200 bg-sand-100">
        {logs.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div>
              <p className="text-sm font-medium text-ink-500">No events yet</p>
              <p className="mt-1 text-sm text-ink-400">
                Events will appear here as the session progresses
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-ink-200">
            {logs.map((entry) => (
              <div key={entry.id} className="p-3 hover:bg-sand-200">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-mono text-xs text-ink-400">
                    {entry.ts.slice(11, 19)}
                  </span>
                  <span className="flex-1 text-sm font-medium text-ink">
                    {entry.message}
                  </span>
                </div>
                {entry.data && (
                  <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs text-ink-600">
                    {JSON.stringify(entry.data, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Log count */}
      <div className="mt-3 text-center text-xs text-ink-400">
        {logs.length} event{logs.length !== 1 ? "s" : ""} logged
      </div>
    </div>
  );
}

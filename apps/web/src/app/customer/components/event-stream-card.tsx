"use client";

import { useState } from "react";
import type { ClientLog } from "../types";

type EventStreamCardProps = {
  entry: ClientLog;
};

/**
 * Detect the event type from the log entry for specialized rendering.
 */
function getEventType(
  entry: ClientLog,
): "tool" | "message" | "ws" | "api" | "general" {
  if (entry.source === "tool" || entry.message === "tool_call") {
    return "tool";
  }
  if (entry.message.startsWith("ws.")) {
    return "ws";
  }
  if (entry.message.startsWith("api.")) {
    return "api";
  }
  if (entry.message.startsWith("message.")) {
    return "message";
  }
  return "general";
}

/**
 * Format a value for display - handles objects, arrays, and primitives.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Tool call card - shows tool name, args, and result.
 */
function ToolCallCard({ entry }: { entry: ClientLog }) {
  const [expanded, setExpanded] = useState(false);
  const data = entry.data ?? {};
  const toolName = (data["toolName"] as string) ?? "Unknown Tool";
  const args = data["args"] as Record<string, unknown> | undefined;
  const result = data["result"];
  const durationMs = data["durationMs"] as number | undefined;
  const success = data["success"] as boolean | undefined;

  return (
    <div
      className={`rounded-lg border-l-4 p-3 ${
        success === false
          ? "border-l-red-500 bg-red-50"
          : "border-l-indigo-500 bg-indigo-50"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-indigo-100">
            <svg
              className="h-3.5 w-3.5 text-indigo-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </span>
          <div>
            <p className="font-semibold text-indigo-900 text-xs">{toolName}</p>
            {durationMs !== undefined && (
              <p className="text-[10px] text-indigo-600">{durationMs}ms</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {success === false && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
              Failed
            </span>
          )}
          <span className="font-mono text-[10px] text-indigo-400">
            {entry.ts.slice(11, 19)}
          </span>
        </div>
      </div>

      {(args || result !== undefined) && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-2 flex items-center gap-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-800"
        >
          <svg
            className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          {expanded ? "Hide details" : "Show details"}
        </button>
      )}

      {expanded && (
        <div className="mt-2 space-y-2">
          {args && Object.keys(args).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-indigo-700 uppercase">
                Arguments
              </p>
              <pre className="mt-1 overflow-x-auto rounded bg-indigo-100/50 p-2 text-[10px] text-indigo-900">
                {formatValue(args)}
              </pre>
            </div>
          )}
          {result !== undefined && (
            <div>
              <p className="text-[10px] font-semibold text-indigo-700 uppercase">
                Result
              </p>
              <pre className="mt-1 overflow-x-auto rounded bg-indigo-100/50 p-2 text-[10px] text-indigo-900 max-h-32 overflow-y-auto">
                {formatValue(result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * WebSocket event card - shows connection status and message types.
 */
function WsEventCard({ entry }: { entry: ClientLog }) {
  const eventName = entry.message.replace("ws.", "");
  const data = entry.data ?? {};
  const type = data["type"] as string | undefined;
  const textLength = data["textLength"] as number | undefined;

  const isConnect = eventName.startsWith("connect");
  const isMessage = eventName === "message";
  const isError = entry.level === "error" || eventName.includes("error");

  return (
    <div
      className={`rounded-lg border p-2 text-[11px] ${
        isError
          ? "border-red-200 bg-red-50"
          : isConnect
            ? "border-emerald-200 bg-emerald-50"
            : "border-ink-100 bg-sand-50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded ${
              isError
                ? "bg-red-100"
                : isConnect
                  ? "bg-emerald-100"
                  : "bg-ink-100"
            }`}
          >
            <svg
              className={`h-3 w-3 ${
                isError
                  ? "text-red-600"
                  : isConnect
                    ? "text-emerald-600"
                    : "text-ink-500"
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </span>
          <span
            className={`font-medium ${
              isError
                ? "text-red-700"
                : isConnect
                  ? "text-emerald-700"
                  : "text-ink-600"
            }`}
          >
            {eventName}
          </span>
        </div>
        <span className="font-mono text-ink-400 text-[10px]">
          {entry.ts.slice(11, 19)}
        </span>
      </div>
      {isMessage && type && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-600">
            {type}
          </span>
          {textLength !== undefined && textLength > 0 && (
            <span className="text-[10px] text-ink-400">{textLength} chars</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * API event card - shows API calls and responses.
 */
function ApiEventCard({ entry }: { entry: ClientLog }) {
  const eventName = entry.message.replace("api.", "");
  const data = entry.data ?? {};
  const status = data["status"] as number | undefined;
  const isError = entry.level === "error" || eventName.includes("failed");

  return (
    <div
      className={`rounded-lg border p-2 text-[11px] ${
        isError ? "border-red-200 bg-red-50" : "border-sky-200 bg-sky-50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded ${
              isError ? "bg-red-100" : "bg-sky-100"
            }`}
          >
            <svg
              className={`h-3 w-3 ${isError ? "text-red-600" : "text-sky-600"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </span>
          <span
            className={`font-medium ${isError ? "text-red-700" : "text-sky-700"}`}
          >
            {eventName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {status !== undefined && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                status >= 400
                  ? "bg-red-100 text-red-700"
                  : "bg-sky-100 text-sky-700"
              }`}
            >
              {status}
            </span>
          )}
          <span className="font-mono text-ink-400 text-[10px]">
            {entry.ts.slice(11, 19)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Generic event card - fallback for other event types.
 */
function GeneralEventCard({ entry }: { entry: ClientLog }) {
  const [expanded, setExpanded] = useState(false);
  const hasData = entry.data && Object.keys(entry.data).length > 0;

  return (
    <div
      className={`rounded-lg border p-2 text-[11px] ${
        entry.level === "error"
          ? "border-red-200 bg-red-50"
          : entry.level === "warn"
            ? "border-amber-200 bg-amber-50"
            : "border-ink-100 bg-sand-50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`font-semibold uppercase text-[10px] ${
            entry.level === "error"
              ? "text-red-700"
              : entry.level === "warn"
                ? "text-amber-700"
                : "text-ink-500"
          }`}
        >
          {entry.level ?? "info"}
        </span>
        <span className="font-mono text-ink-400 text-[10px]">
          {entry.ts.slice(11, 19)}
        </span>
      </div>
      <p className="mt-1 font-medium text-ink-700">{entry.message}</p>
      {hasData && (
        <>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-ink-500 hover:text-ink-700"
          >
            <svg
              className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
            {expanded ? "Hide" : "Details"}
          </button>
          {expanded && (
            <pre className="mt-1.5 overflow-x-auto rounded bg-ink-50 p-2 text-[10px] text-ink-600 max-h-32 overflow-y-auto">
              {formatValue(entry.data)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Event stream card component - renders different card styles based on event type.
 */
export function EventStreamCard({ entry }: EventStreamCardProps) {
  const eventType = getEventType(entry);

  switch (eventType) {
    case "tool":
      return <ToolCallCard entry={entry} />;
    case "ws":
      return <WsEventCard entry={entry} />;
    case "api":
      return <ApiEventCard entry={entry} />;
    default:
      return <GeneralEventCard entry={entry} />;
  }
}

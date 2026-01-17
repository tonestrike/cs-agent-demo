"use client";

import Link from "next/link";

type ChatHeaderProps = {
  status: string;
  confirmedSessionId: string | null;
};

export function ChatHeader({ status, confirmedSessionId }: ChatHeaderProps) {
  const isConnected =
    status.toLowerCase().includes("connected") ||
    status.toLowerCase().includes("session");
  const isNew = status === "New session";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            isConnected
              ? "bg-moss-100 text-moss-700"
              : isNew
                ? "bg-ink-100 text-ink-600"
                : "bg-amber-100 text-amber-700"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isConnected
                ? "bg-moss-500"
                : isNew
                  ? "bg-ink-400"
                  : "bg-amber-500 animate-pulse-subtle"
            }`}
          />
          {status}
        </span>
      </div>
      {confirmedSessionId && (
        <Link
          href={`/agent/calls/${confirmedSessionId}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink"
        >
          View in Agent Dashboard
          <svg
            className="h-3 w-3"
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
        </Link>
      )}
    </div>
  );
}

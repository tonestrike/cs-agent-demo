"use client";

import Link from "next/link";
import { Badge } from "../../../components/ui";

type ChatHeaderProps = {
  status: string;
  confirmedSessionId: string | null;
};

export function ChatHeader({ status, confirmedSessionId }: ChatHeaderProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge className="text-[10px] py-0.5 px-2">{status}</Badge>
      </div>
      {confirmedSessionId && (
        <Link
          href={`/agent/calls/${confirmedSessionId}`}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-ink/50 hover:text-ink"
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

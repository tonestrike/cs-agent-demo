"use client";

import Link from "next/link";
import { Badge } from "../../../components/ui";

type ChatHeaderProps = {
  status: string;
  confirmedSessionId: string | null;
};

export function ChatHeader({ status, confirmedSessionId }: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-ink/10 pb-4">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold text-ink">
          <span className="accent-text">PestCall</span>
        </h1>
        <div className="hidden text-xs text-ink/60 sm:block">
          Ask about appointments • Reschedule or cancel • Get service info
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge className="text-[10px] py-0.5 px-2">{status}</Badge>
        {confirmedSessionId && (
          <Link
            href={`/agent/calls/${confirmedSessionId}`}
            className="text-[10px] font-medium text-ink/50 hover:text-ink"
          >
            Agent view →
          </Link>
        )}
      </div>
    </div>
  );
}

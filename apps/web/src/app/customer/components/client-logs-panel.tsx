"use client";

import { useState } from "react";
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
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyLogs = async () => {
    const payload = { callSessionId, phoneNumber, logs };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!isOpen) {
    return (
      <div className="flex items-center justify-center gap-4 pt-2">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="text-[10px] font-medium text-ink/40 hover:text-ink/60"
        >
          Show debug logs
        </button>
        <button
          type="button"
          onClick={onCopyConversation}
          className="text-[10px] font-medium text-ink/40 hover:text-ink/60"
        >
          Copy conversation JSON
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-ink/10 bg-white/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/50">
          Client Log
        </span>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={copyLogs}
            className="text-[10px] font-medium text-ink/40 hover:text-ink/60"
          >
            {copied ? "Copied" : "Copy logs"}
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="text-[10px] font-medium text-ink/40 hover:text-ink/60"
          >
            Hide
          </button>
        </div>
      </div>
      <div className="max-h-40 space-y-2 overflow-auto text-[10px] text-ink/60">
        {logs.length === 0 ? (
          <p className="text-ink/40">No events yet.</p>
        ) : (
          logs.slice(0, 50).map((entry) => (
            <div key={entry.id}>
              <span className="font-mono text-ink/40">
                {entry.ts.slice(11, 19)}
              </span>{" "}
              <span className="font-medium text-ink/70">{entry.message}</span>
              {entry.data && (
                <pre className="mt-0.5 whitespace-pre-wrap text-[9px] text-ink/50">
                  {JSON.stringify(entry.data)}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

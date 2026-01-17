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
  const [copiedConvo, setCopiedConvo] = useState(false);

  const copyLogs = async () => {
    const payload = { callSessionId, phoneNumber, logs };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleCopyConversation = async () => {
    await onCopyConversation();
    setCopiedConvo(true);
    setTimeout(() => setCopiedConvo(false), 1500);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="rounded-lg border border-ink/15 bg-white px-2.5 py-1.5 text-[10px] font-medium text-ink/60 hover:text-ink/80"
        >
          {isOpen ? "Hide logs" : "Show logs"}
        </button>
        <button
          type="button"
          onClick={handleCopyConversation}
          className="rounded-lg border border-ink/15 bg-white px-2.5 py-1.5 text-[10px] font-medium text-ink/60 hover:text-ink/80"
        >
          {copiedConvo ? "Copied!" : "Copy convo"}
        </button>
      </div>

      {isOpen && (
        <div className="rounded-lg border border-ink/10 bg-white/80 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-ink/50">
              Event Log
            </span>
            <button
              type="button"
              onClick={copyLogs}
              className="text-[9px] font-medium text-ink/40 hover:text-ink/60"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="max-h-32 space-y-1.5 overflow-auto text-[9px] text-ink/60">
            {logs.length === 0 ? (
              <p className="text-ink/40">No events yet.</p>
            ) : (
              logs.slice(0, 30).map((entry) => (
                <div key={entry.id}>
                  <span className="font-mono text-ink/40">
                    {entry.ts.slice(11, 19)}
                  </span>{" "}
                  <span className="font-medium text-ink/70">
                    {entry.message}
                  </span>
                  {entry.data && (
                    <pre className="mt-0.5 whitespace-pre-wrap text-[8px] text-ink/50">
                      {JSON.stringify(entry.data)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useState } from "react";

import { useConversationSession } from "../hooks";
import type { Customer } from "../types";
import {
  ChatHeader,
  CustomerBar,
  RealtimeKitChatPanel,
  RealtimeLogsPanel,
} from "./index";

type RealtimeChatViewProps = {
  customers: Customer[];
  selectedCustomer: Customer | null;
  phoneNumber: string;
  onSelectCustomer: (phone: string) => void;
};

export function RealtimeChatView({
  customers,
  selectedCustomer,
  phoneNumber,
  onSelectCustomer,
}: RealtimeChatViewProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [startingCall, setStartingCall] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [debugOpen, setDebugOpen] = useState(false);
  const {
    status,
    logs,
    turnMetrics,
    confirmedSessionId,
    callSessionId,
    startCall,
    resetSession,
    recordClientLog,
  } = useConversationSession(phoneNumber);

  const handleCustomerChange = useCallback(
    (phone: string) => {
      onSelectCustomer(phone);
      resetSession();
    },
    [onSelectCustomer, resetSession],
  );

  const handleNewSession = useCallback(() => {
    resetSession();
  }, [resetSession]);

  const handleStartCall = useCallback(async () => {
    if (startingCall || !selectedCustomer) {
      return;
    }
    setStartingCall(true);
    try {
      await startCall();
    } finally {
      setStartingCall(false);
    }
  }, [selectedCustomer, startCall, startingCall]);

  const copyConversation = useCallback(async () => {
    const payload = { callSessionId, phoneNumber, status, logs, turnMetrics };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  }, [callSessionId, phoneNumber, status, logs, turnMetrics]);

  return (
    <div className="flex min-w-0 flex-1 overflow-hidden bg-sand-200">
      <aside
        className={`
          fixed bottom-0 left-0 right-0 top-0 z-30 transform bg-white transition-transform duration-200 ease-in-out
          md:relative md:right-auto md:top-0 md:w-80 md:flex-shrink-0 md:border-r md:border-ink-200 md:translate-x-0
          lg:w-96
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="flex h-full flex-col overflow-hidden">
          <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-200 bg-sand-100 px-4 py-3">
            <span className="text-sm font-semibold text-ink">Settings</span>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="flex items-center justify-center text-ink-400 hover:text-ink-600 md:hidden"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <div className="space-y-6">
              <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
                <h3 className="mb-4 text-sm font-semibold text-ink">
                  Realtime Status
                </h3>
                <ChatHeader
                  status={status}
                  confirmedSessionId={confirmedSessionId}
                />
              </div>

              <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
                <h3 className="mb-4 text-sm font-semibold text-ink">
                  Customer
                </h3>
                <CustomerBar
                  customers={customers}
                  selectedCustomer={selectedCustomer}
                  phoneNumber={phoneNumber}
                  onSelectCustomer={handleCustomerChange}
                  onNewSession={handleNewSession}
                />
              </div>
            </div>
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-ink/30 md:hidden"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && setSidebarOpen(false)}
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-200 bg-white px-4 py-2.5 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex items-center gap-2 rounded-lg border border-ink-200 bg-sand-100 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-sand-200"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
            Menu
          </button>
          <span className="rounded-full bg-ink-100 px-3 py-1 text-sm font-medium text-ink-600">
            {status}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-shrink-0 px-4 pt-4">
            <div className="mb-4 rounded-2xl border border-ink-100 bg-white/90 px-4 py-3 shadow-soft backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                    Live concierge
                  </p>
                  <p className="text-[11px] text-ink-500">
                    Kick off an incoming call; transcripts stream here and bot
                    voice is optional.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={ttsEnabled}
                    onClick={() => setTtsEnabled((prev) => !prev)}
                    className={`group flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-ink/20 ${
                      ttsEnabled
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 shadow-[0_8px_24px_rgba(16,185,129,0.18)]"
                        : "border-ink-200 bg-white text-ink-600 hover:bg-sand-50"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-10 items-center rounded-full transition ${
                        ttsEnabled ? "bg-emerald-500" : "bg-ink-200"
                      }`}
                    >
                      <span
                        className={`h-4 w-4 rounded-full bg-white shadow transition ${
                          ttsEnabled ? "translate-x-5" : "translate-x-1"
                        }`}
                      />
                    </span>
                    <span className="whitespace-nowrap">
                      {ttsEnabled ? "Bot voice on" : "Bot voice off"}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleStartCall}
                    disabled={!selectedCustomer || startingCall}
                    className="flex items-center gap-2 rounded-full border border-emerald-600 bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-soft transition hover:-translate-y-[1px] hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label="Start call"
                  >
                    <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/80 shadow-inner">
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.8}
                          d="M5 5a2 2 0 012-2h2l1 4-2 1a10 10 0 005 5l1-2 4 1v2a2 2 0 01-2 2 13 13 0 01-13-13z"
                        />
                      </svg>
                    </span>
                    <span className="hidden sm:inline">
                      {startingCall ? "Starting..." : "Start call"}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDebugOpen((prev) => !prev)}
                    className={`rounded-full border px-4 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-amber-500/30 ${
                      debugOpen
                        ? "border-amber-600 bg-amber-600 text-white shadow-soft hover:bg-amber-700"
                        : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                    }`}
                  >
                    {debugOpen ? "Close debug" : "Open debug"}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="relative flex-1 min-h-0 overflow-hidden">
            {/* Keep chat mounted even when debug drawer overlays it */}
            <div className="absolute inset-0">
              <RealtimeKitChatPanel
                sessionId={callSessionId}
                customer={selectedCustomer}
                enableTts={ttsEnabled}
                onDebugEvent={recordClientLog}
              />
            </div>

            {debugOpen && (
              <div className="absolute inset-0 z-10 flex flex-col bg-ink/10 backdrop-blur-sm">
                <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                      Realtime debugging cockpit
                    </p>
                    <p className="text-sm text-ink-800">
                      Full-width view of live events, health, and summaries
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={copyConversation}
                      className="rounded-lg border border-ink-200 bg-sand-100 px-3 py-2 text-xs font-semibold text-ink-700 transition hover:bg-sand-200"
                    >
                      Copy chat + debug
                    </button>
                    <button
                      type="button"
                      onClick={() => setDebugOpen(false)}
                      className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-700 transition hover:bg-sand-100"
                    >
                      Close debug
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden bg-white shadow-2xl">
                  <div className="h-full overflow-y-auto px-4 py-4 md:px-6">
                    <RealtimeLogsPanel
                      logs={logs}
                      turnMetrics={turnMetrics}
                      callSessionId={callSessionId}
                      phoneNumber={phoneNumber}
                      status={status}
                      onCopyConversation={copyConversation}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

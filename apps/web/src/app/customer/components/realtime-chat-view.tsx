"use client";

import { useCallback, useState } from "react";

import { useConversationSession } from "../hooks";
import type { Customer } from "../types";
import { ChatHeader, CustomerBar, RealtimeKitChatPanel } from "./index";

type SidebarTab = "settings" | "logs";

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
  const [activeTab, setActiveTab] = useState<SidebarTab>("settings");
  const [startingCall, setStartingCall] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const {
    status,
    logs,
    turnMetrics,
    confirmedSessionId,
    callSessionId,
    startCall,
    resetSession,
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
      await startCall(selectedCustomer.zipCode ?? undefined);
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
          <div className="flex flex-shrink-0 border-b border-ink-200 bg-sand-100">
            <button
              type="button"
              onClick={() => setActiveTab("settings")}
              className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${
                activeTab === "settings"
                  ? "border-b-2 border-ink bg-white text-ink"
                  : "text-ink-500 hover:text-ink-700"
              }`}
            >
              Settings
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("logs")}
              className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${
                activeTab === "logs"
                  ? "border-b-2 border-ink bg-white text-ink"
                  : "text-ink-500 hover:text-ink-700"
              }`}
            >
              Logs
              {logs.length > 0 && (
                <span className="ml-2 rounded-full bg-ink-200 px-2 py-0.5 text-xs">
                  {logs.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="flex items-center justify-center px-3 text-ink-400 hover:text-ink-600 md:hidden"
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
            {activeTab === "settings" ? (
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
            ) : (
              <div className="space-y-3 rounded-xl border border-ink-200 bg-white p-5 text-sm text-ink-600 shadow-soft">
                <p className="font-semibold text-ink">Realtime logs</p>
                <button
                  type="button"
                  onClick={copyConversation}
                  className="w-full rounded-lg border border-ink-200 bg-sand-100 py-2 text-xs font-semibold text-ink-700 hover:bg-sand-200"
                >
                  Copy realtime logs
                </button>
                <div className="space-y-2 text-xs">
                  {logs.length === 0 && (
                    <p className="text-ink-400">No realtime logs yet.</p>
                  )}
                  {logs.slice(0, 8).map((entry) => (
                    <p key={entry.id}>
                      {entry.ts} — {entry.message}
                    </p>
                  ))}
                </div>
              </div>
            )}
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

        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex-shrink-0 px-4 pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 pb-3">
              <div className="space-y-1">
                <p className="text-xs text-ink-500">
                  Start an incoming call session (runs verification before the
                  customer replies).
                </p>
                <p className="text-[11px] text-ink-400">
                  Mic + live transcripts stream here; bot voice is optional.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTtsEnabled((prev) => !prev)}
                  className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-600 transition hover:bg-sand-50"
                >
                  {ttsEnabled ? "Bot voice on" : "Bot voice off"}
                </button>
                <button
                  type="button"
                  onClick={handleStartCall}
                  disabled={!selectedCustomer || startingCall}
                  className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-xs font-semibold text-ink-600 transition hover:bg-sand-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {startingCall ? "Starting..." : "Start call"}
                </button>
              </div>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <RealtimeKitChatPanel
              sessionId={callSessionId}
              customer={selectedCustomer}
              enableTts={ttsEnabled}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

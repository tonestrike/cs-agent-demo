"use client";

import { useCallback, useState } from "react";
import {
  ChatHeader,
  ChatInput,
  ChatMessages,
  ClientLogsPanel,
  CustomerBar,
} from "./components";
import { useConversationSession, useCustomers } from "./hooks";

export default function CustomerPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { customers, selectedCustomer, phoneNumber, selectCustomer } =
    useCustomers();

  const {
    messages,
    status,
    logs,
    confirmedSessionId,
    callSessionId,
    sendMessage,
    resetSession,
  } = useConversationSession(phoneNumber);

  const handleCustomerChange = useCallback(
    (phone: string) => {
      selectCustomer(phone);
      resetSession();
    },
    [selectCustomer, resetSession],
  );

  const handleNewSession = useCallback(() => {
    resetSession();
  }, [resetSession]);

  const copyConversation = useCallback(async () => {
    const payload = { callSessionId, phoneNumber, messages };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  }, [callSessionId, phoneNumber, messages]);

  const statusLine =
    status === "New session" || status.startsWith("Session ") ? "" : status;

  return (
    <div className="fixed inset-0 top-[73px] flex overflow-hidden bg-sand">
      {/* Sidebar - desktop always visible, mobile slide-in */}
      <aside
        className={`
          fixed inset-y-0 left-0 top-[73px] z-30 w-72 flex-shrink-0 transform border-r border-ink/10 bg-white/95 backdrop-blur-sm transition-transform duration-200 ease-in-out
          md:relative md:top-0 md:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="flex h-full flex-col overflow-hidden">
          {/* Sidebar header */}
          <div className="flex flex-shrink-0 items-center justify-between border-b border-ink/10 px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink/50">
              Settings
            </span>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink/40 hover:text-ink/60 md:hidden"
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Sidebar content - scrollable */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              {/* Status section */}
              <div className="rounded-xl border border-ink/10 bg-white/60 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink/50">
                  Session Status
                </p>
                <ChatHeader
                  status={status}
                  confirmedSessionId={confirmedSessionId}
                />
              </div>

              {/* Customer selector */}
              <div className="rounded-xl border border-ink/10 bg-white/60 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink/50">
                  Customer
                </p>
                <CustomerBar
                  customers={customers}
                  selectedCustomer={selectedCustomer}
                  phoneNumber={phoneNumber}
                  onSelectCustomer={handleCustomerChange}
                  onNewSession={handleNewSession}
                />
              </div>

              {/* Debug logs */}
              <div className="rounded-xl border border-ink/10 bg-white/60 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink/50">
                  Debug
                </p>
                <ClientLogsPanel
                  logs={logs}
                  callSessionId={callSessionId}
                  phoneNumber={phoneNumber}
                  onCopyConversation={copyConversation}
                />
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 top-[73px] z-20 bg-ink/20 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && setSidebarOpen(false)}
        />
      )}

      {/* Main chat area */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile toolbar */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-ink/10 bg-white/80 px-4 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex items-center gap-2 rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs font-medium text-ink/70"
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
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            Settings
          </button>
          <span className="text-xs text-ink/50">{status}</span>
        </div>

        {/* Messages area - fills remaining space */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatMessages messages={messages} statusText={statusLine} />
        </div>

        {/* Input bar pinned at bottom */}
        <div className="flex-shrink-0 border-t border-ink/10 bg-white/90 p-3 backdrop-blur-sm sm:p-4">
          <div className="mx-auto max-w-3xl">
            <ChatInput
              onSend={sendMessage}
              quickZip={selectedCustomer?.zipCode}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

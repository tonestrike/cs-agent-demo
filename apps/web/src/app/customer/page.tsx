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
    <div className="flex h-screen w-screen overflow-hidden bg-sand">
      {/* Mobile header */}
      <div className="fixed left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-ink/10 bg-sand/95 px-4 py-3 backdrop-blur-sm md:hidden">
        <h1 className="text-lg font-semibold text-ink">
          <span className="accent-text">PestCall</span>
        </h1>
        <button
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/15 bg-white/80 text-ink/60"
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
        </button>
      </div>

      {/* Sidebar - desktop always visible, mobile slide-in */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-30 w-72 transform border-r border-ink/10 bg-white/80 backdrop-blur-sm transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="flex h-full flex-col">
          {/* Sidebar header */}
          <div className="flex items-center justify-between border-b border-ink/10 px-4 py-4">
            <h1 className="text-lg font-semibold text-ink">
              <span className="accent-text">PestCall</span>
            </h1>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/40 hover:text-ink/60 md:hidden"
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

          {/* Sidebar content */}
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
          className="fixed inset-0 z-20 bg-ink/20 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && setSidebarOpen(false)}
        />
      )}

      {/* Main chat area */}
      <main className="flex flex-1 flex-col overflow-hidden pt-14 md:pt-0">
        {/* Messages area */}
        <div className="flex-1 overflow-hidden">
          <ChatMessages messages={messages} statusText={statusLine} />
        </div>

        {/* Input bar pinned at bottom */}
        <div className="border-t border-ink/10 bg-white/80 p-3 backdrop-blur-sm sm:p-4">
          <div className="mx-auto max-w-3xl">
            <ChatInput onSend={sendMessage} quickZip={selectedCustomer?.zipCode} />
          </div>
        </div>
      </main>
    </div>
  );
}

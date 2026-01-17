"use client";

import { useCallback, useState } from "react";
import {
  ChatHeader,
  ChatInput,
  ChatMessages,
  ClientLogsPanel,
  CustomerBar,
  RealtimeKitChatPanel,
} from "./components";
import { useConversationSession, useCustomers } from "./hooks";

type SidebarTab = "settings" | "logs";
type ChatMode = "classic" | "realtime";

export default function CustomerPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SidebarTab>("settings");
  const { customers, selectedCustomer, phoneNumber, selectCustomer } =
    useCustomers();

  const {
    messages,
    status,
    logs,
    confirmedSessionId,
    callSessionId,
    sendMessage,
    startCall,
    resetSession,
  } = useConversationSession(phoneNumber);
  const [startingCall, setStartingCall] = useState(false);

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

  const [chatMode, setChatMode] = useState<ChatMode>("classic");

  return (
    <div className="fixed inset-0 top-[57px] flex overflow-hidden bg-sand-200">
      {/* Sidebar - full screen on mobile, fixed width on desktop */}
      <aside
        className={`
          fixed bottom-0 left-0 right-0 top-[57px] z-30 transform bg-white transition-transform duration-200 ease-in-out
          md:relative md:right-auto md:top-0 md:w-80 md:flex-shrink-0 md:border-r md:border-ink-200 md:translate-x-0
          lg:w-96
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="flex h-full flex-col overflow-hidden">
          {/* Sidebar tabs */}
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

          {/* Sidebar content - scrollable */}
          <div className="flex-1 overflow-y-auto p-5">
            {activeTab === "settings" ? (
              <div className="space-y-6">
                {/* Status section */}
                <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
                  <h3 className="mb-4 text-sm font-semibold text-ink">
                    Session Status
                  </h3>
                  <ChatHeader
                    status={status}
                    confirmedSessionId={confirmedSessionId}
                  />
                </div>

                {/* Customer selector */}
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
              <ClientLogsPanel
                logs={logs}
                callSessionId={callSessionId}
                phoneNumber={phoneNumber}
                onCopyConversation={copyConversation}
              />
            )}
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 top-[57px] z-20 bg-ink/30 md:hidden"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && setSidebarOpen(false)}
        />
      )}

      {/* Main chat area */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile toolbar */}
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

        {/* Chat content area */}
        <div className="min-h-0 flex-1 overflow-hidden flex flex-col">
          <div className="flex flex-shrink-0 border-b border-ink-200 bg-sand-100">
            <button
              type="button"
              onClick={() => setChatMode("classic")}
              className={`flex-1 px-6 py-3 text-sm font-semibold transition-colors ${
                chatMode === "classic"
                  ? "border-b-2 border-ink bg-white text-ink"
                  : "text-ink-500 hover:text-ink-700"
              }`}
            >
              Classic chat
            </button>
            <button
              type="button"
              onClick={() => setChatMode("realtime")}
              className={`flex-1 px-6 py-3 text-sm font-semibold transition-colors ${
                chatMode === "realtime"
                  ? "border-b-2 border-ink bg-white text-ink"
                  : "text-ink-500 hover:text-ink-700"
              }`}
            >
              Realtime chat
            </button>
          </div>
          {chatMode === "classic" ? (
            <>
              {/* Messages area - fills remaining space */}
              <div className="min-h-0 flex-1 overflow-hidden">
                <ChatMessages messages={messages} />
              </div>

              {/* Input bar pinned at bottom */}
              <div className="flex-shrink-0 border-t border-ink-200 bg-white p-4">
                <div className="mx-auto max-w-3xl">
                  <ChatInput
                    onSend={sendMessage}
                    quickZip={selectedCustomer?.zipCode}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-hidden px-4 pb-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 pb-3">
                <p className="text-xs text-ink-500">
                  Start an incoming call session (runs verification before the
                  customer replies).
                </p>
                <button
                  type="button"
                  onClick={handleStartCall}
                  disabled={!selectedCustomer || startingCall}
                  className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-xs font-semibold text-ink-600 transition hover:bg-sand-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {startingCall ? "Starting…" : "Start call"}
                </button>
              </div>
              <RealtimeKitChatPanel
                sessionId={callSessionId}
                customer={selectedCustomer}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

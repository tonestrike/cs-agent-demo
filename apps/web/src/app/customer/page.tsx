"use client";

import { useCallback } from "react";
import { Card } from "../../components/ui";
import {
  ChatHeader,
  ChatInput,
  ChatMessages,
  ClientLogsPanel,
  CustomerBar,
} from "./components";
import { useConversationSession, useCustomers } from "./hooks";

export default function CustomerPage() {
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
    <main className="grid-dots min-h-screen px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto flex h-[calc(100vh-3rem)] max-w-2xl flex-col sm:h-[calc(100vh-4rem)]">
        <Card className="flex flex-1 flex-col gap-4 animate-rise overflow-hidden">
          <ChatHeader status={status} confirmedSessionId={confirmedSessionId} />

          <ChatMessages messages={messages} statusText={statusLine} />

          <div className="space-y-3">
            <CustomerBar
              customers={customers}
              selectedCustomer={selectedCustomer}
              phoneNumber={phoneNumber}
              onSelectCustomer={handleCustomerChange}
              onNewSession={handleNewSession}
            />

            <ChatInput
              onSend={sendMessage}
              quickZip={selectedCustomer?.zipCode}
            />
          </div>

          <ClientLogsPanel
            logs={logs}
            callSessionId={callSessionId}
            phoneNumber={phoneNumber}
            onCopyConversation={copyConversation}
          />
        </Card>
      </div>
    </main>
  );
}

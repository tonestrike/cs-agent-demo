"use client";

import { useCallback, useState } from "react";
import { ClassicChatView, RealtimeChatView } from "./components";
import { useCustomers } from "./hooks";

type ChatMode = "classic" | "realtime";

export default function CustomerPage() {
  const { customers, selectedCustomer, phoneNumber, selectCustomer } =
    useCustomers();
  const [chatMode, setChatMode] = useState<ChatMode>("classic");

  const handleCustomerChange = useCallback(
    (phone: string) => {
      selectCustomer(phone);
    },
    [selectCustomer],
  );

  return (
    <div className="fixed inset-0 top-[57px] flex flex-col overflow-hidden bg-sand-200">
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
        <ClassicChatView
          customers={customers}
          selectedCustomer={selectedCustomer}
          phoneNumber={phoneNumber}
          onSelectCustomer={handleCustomerChange}
        />
      ) : (
        <RealtimeChatView
          customers={customers}
          selectedCustomer={selectedCustomer}
          phoneNumber={phoneNumber}
          onSelectCustomer={handleCustomerChange}
        />
      )}
    </div>
  );
}

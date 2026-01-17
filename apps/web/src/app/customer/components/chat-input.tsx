"use client";

import { useState } from "react";

type ChatInputProps = {
  onSend: (message: string) => void;
  quickZip?: string | null;
};

export function ChatInput({ onSend, quickZip }: ChatInputProps) {
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (input.trim()) {
      onSend(input.trim());
      setInput("");
    }
  };

  return (
    <div className="flex items-end gap-2">
      <div className="relative flex-1">
        <input
          id="customer-message"
          className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 pr-16 text-sm text-ink shadow-soft placeholder:text-ink-300 focus:border-ink-400 focus:outline-none focus:ring-0"
          placeholder="Type your message..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
        />
        {quickZip && (
          <button
            type="button"
            onClick={() => onSend(quickZip)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-200"
            title={`Send ZIP: ${quickZip}`}
          >
            ZIP
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={handleSend}
        disabled={!input.trim()}
        className="flex h-[46px] items-center justify-center rounded-xl bg-ink px-5 text-sm font-medium text-white shadow-medium transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:bg-ink-300"
      >
        <span className="hidden sm:inline">Send</span>
        <svg
          className="h-5 w-5 sm:hidden"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
          />
        </svg>
      </button>
    </div>
  );
}

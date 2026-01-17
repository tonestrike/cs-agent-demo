"use client";

import { useState } from "react";
import { Button } from "../../../components/ui";

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
          className="w-full rounded-2xl border border-ink/15 bg-white px-4 py-3 pr-12 text-sm shadow-soft focus:border-ink/30 focus:outline-none"
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
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-ink/5 px-2 py-1 text-[10px] font-medium text-ink/50 hover:bg-ink/10 hover:text-ink/70"
            title={`Send ZIP: ${quickZip}`}
          >
            ZIP
          </button>
        )}
      </div>
      <Button
        onClick={handleSend}
        className="!rounded-2xl !py-3 !px-5"
        disabled={!input.trim()}
      >
        <span className="hidden sm:inline">Send</span>
        <svg
          className="h-4 w-4 sm:hidden"
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
      </Button>
    </div>
  );
}

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
    <div className="flex gap-2">
      <input
        id="customer-message"
        className="flex-1 rounded-xl border border-ink/15 bg-white/80 px-3 py-2 text-sm shadow-soft"
        placeholder="Ask about appointments, reschedule, or cancel..."
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSend();
          }
        }}
      />
      <Button onClick={handleSend} className="!py-2 !px-4">
        Send
      </Button>
      {quickZip && (
        <Button
          type="button"
          onClick={() => onSend(quickZip)}
          className="!py-2 !px-3 bg-white/80 text-ink text-xs"
        >
          ZIP
        </Button>
      )}
    </div>
  );
}

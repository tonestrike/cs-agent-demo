"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "../types";

type ChatMessagesProps = {
  messages: ChatMessage[];
};

export function ChatMessages({ messages }: ChatMessagesProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    if (shouldAutoScroll.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  });

  return (
    <div
      ref={listRef}
      className="scroll-area flex flex-1 flex-col gap-3 overflow-y-auto rounded-2xl border border-ink/10 bg-white/60 p-4"
      onScroll={(event) => {
        const target = event.currentTarget;
        const distanceFromBottom =
          target.scrollHeight - target.scrollTop - target.clientHeight;
        shouldAutoScroll.current = distanceFromBottom < 24;
      }}
    >
      {messages.map((message) => (
        <div
          key={message.id}
          className={`animate-rise max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
            message.role === "customer"
              ? "ml-auto bg-ink text-sand shadow-soft"
              : "bg-sand text-ink shadow-soft"
          }`}
        >
          <p className="text-[10px] uppercase tracking-wide opacity-50">
            {message.role === "customer" ? "You" : "PestCall"}
          </p>
          <p className="mt-0.5">{message.text}</p>
        </div>
      ))}
    </div>
  );
}

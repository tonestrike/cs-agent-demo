"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "../types";

type ChatMessagesProps = {
  messages: ChatMessage[];
  statusText?: string;
};

export function ChatMessages({ messages, statusText }: ChatMessagesProps) {
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
      className="scroll-area flex h-full flex-col gap-3 overflow-y-auto bg-sand p-4 sm:p-6"
      onScroll={(event) => {
        const target = event.currentTarget;
        const distanceFromBottom =
          target.scrollHeight - target.scrollTop - target.clientHeight;
        shouldAutoScroll.current = distanceFromBottom < 24;
      }}
    >
      <div className="mx-auto w-full max-w-3xl flex-1">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="rounded-2xl border border-ink/10 bg-white/60 p-6 shadow-soft">
              <p className="text-sm text-ink/60">
                Start a conversation with PestCall
              </p>
              <p className="mt-1 text-xs text-ink/40">
                Ask about appointments, reschedule, or get service info
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`animate-rise max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-soft ${
                  message.role === "customer"
                    ? "ml-auto bg-ink text-sand"
                    : "bg-white text-ink"
                }`}
              >
                <p className="text-[10px] uppercase tracking-wide opacity-50">
                  {message.role === "customer" ? "You" : "PestCall"}
                </p>
                <p className="mt-1">
                  {message.text || (message.role === "agent" ? "…" : "")}
                </p>
              </div>
            ))}
            {statusText ? (
              <div className="inline-block rounded-full border border-ink/10 bg-white/70 px-3 py-1.5 text-[11px] text-ink/60 shadow-soft">
                {statusText}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

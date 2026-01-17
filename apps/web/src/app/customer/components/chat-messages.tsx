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
      className="scroll-area flex h-full flex-col gap-3 overflow-y-auto bg-sand-200 p-4 sm:p-6"
      onScroll={(event) => {
        const target = event.currentTarget;
        const distanceFromBottom =
          target.scrollHeight - target.scrollTop - target.clientHeight;
        shouldAutoScroll.current = distanceFromBottom < 24;
      }}
    >
      <div className="mx-auto w-full max-w-3xl flex-1">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center">
            <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-6 shadow-soft">
              <h2 className="text-lg font-semibold text-ink">
                What can I help you with?
              </h2>
              <p className="mt-1 text-sm text-ink-400">
                Try asking about any of the following:
              </p>
              <ul className="mt-4 space-y-3">
                <li className="flex items-start gap-3 rounded-lg bg-sand-100 p-3">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                  </span>
                  <div>
                    <p className="text-sm font-medium text-ink">
                      Schedule an appointment
                    </p>
                    <p className="text-xs text-ink-400">
                      "I need to book a pest inspection"
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3 rounded-lg bg-sand-100 p-3">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-moss-100 text-moss-600">
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  </span>
                  <div>
                    <p className="text-sm font-medium text-ink">
                      Reschedule or cancel
                    </p>
                    <p className="text-xs text-ink-400">
                      "I need to move my appointment"
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3 rounded-lg bg-sand-100 p-3">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-clay-100 text-clay-600">
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </span>
                  <div>
                    <p className="text-sm font-medium text-ink">
                      Ask a question
                    </p>
                    <p className="text-xs text-ink-400">
                      "What services do you offer?"
                    </p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <div key={message.id}>
                {message.role === "status" ? (
                  <div className="inline-flex rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-500 shadow-soft">
                    {message.text}
                  </div>
                ) : (
                  <div
                    className={`animate-rise max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      message.role === "customer"
                        ? "ml-auto bg-ink text-white shadow-medium"
                        : "bg-white text-ink shadow-soft border border-ink-100"
                    }`}
                  >
                    <p
                      className={`text-[10px] font-semibold uppercase tracking-wider ${
                        message.role === "customer"
                          ? "text-white/60"
                          : "text-ink-400"
                      }`}
                    >
                      {message.role === "customer" ? "You" : "PestCall"}
                    </p>
                    <p className="mt-1">
                      {message.text || (message.role === "agent" ? "..." : "")}
                    </p>
                  </div>
                )}
              </div>
            ))}
            {statusText ? (
              <div className="inline-block rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-500 shadow-soft">
                {statusText}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

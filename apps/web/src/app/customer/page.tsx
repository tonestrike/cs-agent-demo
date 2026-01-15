"use client";

import { useMutation } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import { Badge, Button, Card } from "../../components/ui";
import { callRpc } from "../../lib/api";

type ChatMessage = {
  id: string;
  role: "customer" | "agent";
  text: string;
};

export default function CustomerPage() {
  const [phoneNumber, setPhoneNumber] = useState("+14155552671");
  const [input, setInput] = useState("");
  const [callSessionId, setCallSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "intro",
      role: "agent",
      text: "Hi! This is PestCall. How can I help today?",
    },
  ]);
  const listRef = useRef<HTMLDivElement | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: {
        phoneNumber: string;
        text: string;
        callSessionId?: string;
      } = {
        phoneNumber,
        text: input,
      };
      if (callSessionId) {
        payload.callSessionId = callSessionId;
      }
      return callRpc<{
        callSessionId: string;
        replyText: string;
      }>("agent/message", payload);
    },
    onSuccess: (data) => {
      setCallSessionId(data.callSessionId);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "agent", text: data.replyText },
      ]);
      setInput("");
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({
          top: listRef.current.scrollHeight,
          behavior: "smooth",
        });
      });
    },
  });

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || mutation.isPending) {
      return;
    }
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "customer", text: trimmed },
    ]);
    mutation.mutate();
  };

  const statusLabel = useMemo(() => {
    if (mutation.isPending) {
      return "Agent is responding...";
    }
    if (mutation.isError) {
      return "We hit a snag. Try again.";
    }
    return callSessionId
      ? `Session ${callSessionId.slice(0, 8)}…`
      : "New session";
  }, [callSessionId, mutation.isError, mutation.isPending]);

  return (
    <main className="grid-dots min-h-screen px-6 py-10">
      <div className="mx-auto grid w-full max-w-5xl gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="flex flex-col gap-6">
          <div className="flex items-start justify-between">
            <div>
              <Badge className="w-fit">Customer Portal</Badge>
              <h1 className="mt-3 text-3xl font-semibold text-ink">
                Talk to PestCall
              </h1>
            </div>
            <span className="text-xs uppercase tracking-wide text-ink/60">
              {statusLabel}
            </span>
          </div>

          <div
            ref={listRef}
            className="flex max-h-[420px] flex-col gap-4 overflow-y-auto rounded-2xl border border-ink/10 bg-white/70 p-4"
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  message.role === "customer"
                    ? "ml-auto bg-ink text-sand"
                    : "bg-sand text-ink"
                }`}
              >
                <p className="text-xs uppercase tracking-wide opacity-60">
                  {message.role === "customer" ? "You" : "PestCall"}
                </p>
                <p className="mt-1">{message.text}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <label
              htmlFor="customer-phone"
              className="text-xs uppercase tracking-wide text-ink/60"
            >
              Phone Number
            </label>
            <input
              id="customer-phone"
              className="rounded-2xl border border-ink/15 bg-white/80 px-4 py-2 text-sm"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-3">
            <label
              htmlFor="customer-message"
              className="text-xs uppercase tracking-wide text-ink/60"
            >
              Message
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="customer-message"
                className="flex-1 rounded-2xl border border-ink/15 bg-white/80 px-4 py-2 text-sm"
                placeholder="Ask about appointments or billing..."
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleSend();
                  }
                }}
              />
              <Button onClick={handleSend} disabled={mutation.isPending}>
                Send
              </Button>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col gap-5">
          <Badge className="w-fit">Tips</Badge>
          <div className="space-y-4 text-sm text-ink/70">
            <p>Try: “When is my next appointment?” or “Do I owe anything?”</p>
            <p>
              For billing, the agent will ask for your ZIP before sharing
              balances.
            </p>
            <p>
              Use the same session to continue the conversation and test
              follow-ups like “reschedule it.”
            </p>
          </div>
        </Card>
      </div>
    </main>
  );
}

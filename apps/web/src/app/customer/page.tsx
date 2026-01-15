"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Badge, Button, Card } from "../../components/ui";
import { createAgentClient } from "../../lib/agent-client";

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
  const [status, setStatus] = useState("New session");
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<ReturnType<typeof createAgentClient> | null>(null);
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      clientRef.current?.close();
    };
  }, []);

  const ensureClient = (sessionId: string) => {
    if (clientRef.current && sessionRef.current === sessionId) {
      return clientRef.current;
    }
    clientRef.current?.close();
    const client = createAgentClient(sessionId);
    clientRef.current = client;
    sessionRef.current = sessionId;
    return client;
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    const sessionId = callSessionId ?? crypto.randomUUID();
    if (!callSessionId) {
      setCallSessionId(sessionId);
    }
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "customer", text: trimmed },
    ]);
    setInput("");
    setStatus("Streaming reply...");

    const responseId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: responseId, role: "agent", text: "" },
    ]);

    const client = ensureClient(sessionId);
    client
      .call(
        "messageStream",
        [
          {
            phoneNumber,
            text: trimmed,
            callSessionId: sessionId,
          },
        ],
        {
          onChunk: (chunk) => {
            if (
              chunk &&
              typeof chunk === "object" &&
              "type" in chunk &&
              (chunk as { type?: unknown }).type === "delta"
            ) {
              const text = String((chunk as { text?: unknown }).text ?? "");
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === responseId
                    ? { ...message, text: `${message.text}${text}` }
                    : message,
                ),
              );
            }
          },
          onDone: (finalChunk) => {
            setStatus(`Session ${sessionId.slice(0, 8)}…`);
            if (
              finalChunk &&
              typeof finalChunk === "object" &&
              "type" in finalChunk &&
              (finalChunk as { type?: unknown }).type === "final"
            ) {
              const data = (
                finalChunk as {
                  data?: { callSessionId?: string };
                }
              ).data;
              if (data?.callSessionId) {
                setCallSessionId(data.callSessionId);
              }
            }
            requestAnimationFrame(() => {
              listRef.current?.scrollTo({
                top: listRef.current.scrollHeight,
                behavior: "smooth",
              });
            });
          },
          onError: () => {
            setStatus("Connection issue. Try again.");
          },
        },
      )
      .catch(() => {
        setStatus("Connection issue. Try again.");
      });
  };

  const statusLabel = useMemo(() => {
    return status;
  }, [status]);

  const copyConversation = async () => {
    const payload = {
      callSessionId,
      phoneNumber,
      messages,
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

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
            <div className="flex flex-col items-end gap-2">
              <span className="text-xs uppercase tracking-wide text-ink/60">
                {statusLabel}
              </span>
              <button
                type="button"
                onClick={copyConversation}
                className="text-xs font-semibold uppercase tracking-wide text-ink/50 hover:text-ink"
              >
                {copied ? "Copied" : "Copy JSON"}
              </button>
            </div>
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
              <Button onClick={handleSend}>Send</Button>
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

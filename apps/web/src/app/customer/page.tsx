"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge, Button, Card } from "../../components/ui";
import { apiBaseUrl, demoAuthToken } from "../../lib/env";
import { orpc } from "../../lib/orpc";

type ChatMessage = {
  id: string;
  role: "customer" | "agent";
  text: string;
};

export default function CustomerPage() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [input, setInput] = useState("");
  const [callSessionId, setCallSessionId] = useState<string | null>(null);
  const [confirmedSessionId, setConfirmedSessionId] = useState<string | null>(
    null,
  );
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
  const shouldAutoScroll = useRef(true);
  const socketRef = useRef<WebSocket | null>(null);
  const responseIdRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  const customersQuery = useQuery(
    orpc.customers.list.queryOptions({
      input: { limit: 50 },
    }),
  );

  useEffect(() => {
    const items = customersQuery.data?.items ?? [];
    if (items.length === 0) {
      return;
    }
    setPhoneNumber((current) => current || items[0]?.phoneE164 || "");
  }, [customersQuery.data]);

  useEffect(() => {
    if (shouldAutoScroll.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  });

  const buildWsUrl = (sessionId: string) => {
    const base = apiBaseUrl || window.location.origin;
    const url = new URL(base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/ws/conversations/${sessionId}`;
    if (demoAuthToken) {
      url.searchParams.set("token", demoAuthToken);
    }
    return url.toString();
  };

  const ensureSocket = (sessionId: string) => {
    if (socketRef.current && sessionRef.current === sessionId) {
      if (socketRef.current.readyState === WebSocket.OPEN) {
        return Promise.resolve(socketRef.current);
      }
      return new Promise<WebSocket>((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket) {
          reject(new Error("Socket unavailable"));
          return;
        }
        const timeoutId = window.setTimeout(() => {
          reject(new Error("Socket timeout"));
        }, 3000);
        socket.addEventListener("open", () => {
          window.clearTimeout(timeoutId);
          resolve(socket);
        });
        socket.addEventListener("error", () => {
          window.clearTimeout(timeoutId);
          reject(new Error("Socket error"));
        });
      });
    }
    socketRef.current?.close();
    const socket = new WebSocket(buildWsUrl(sessionId));
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as {
          type?: string;
          text?: string;
          data?: { callSessionId?: string; replyText?: string };
        };
        if (payload.type === "status") {
          const text = payload.text ?? "";
          if (text.trim()) {
            setStatus(text);
          }
          return;
        }
        if (payload.type === "delta") {
          const text = payload.text ?? "";
          const responseId = responseIdRef.current;
          if (!responseId || !text) {
            return;
          }
          setMessages((prev) =>
            prev.map((message) =>
              message.id === responseId
                ? { ...message, text: `${message.text}${text}` }
                : message,
            ),
          );
          return;
        }
        if (payload.type === "final") {
          const data = payload.data;
          const replyText = data?.replyText ?? "";
          const responseId = responseIdRef.current;
          if (responseId && replyText) {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === responseId && !message.text
                  ? { ...message, text: replyText }
                  : message,
              ),
            );
          }
          if (data?.callSessionId) {
            setCallSessionId(data.callSessionId);
            setConfirmedSessionId(data.callSessionId);
          }
          setStatus(`Session ${sessionId.slice(0, 8)}…`);
        }
      } catch {
        setStatus("Received malformed message.");
      }
      requestAnimationFrame(() => {
        if (shouldAutoScroll.current && listRef.current) {
          listRef.current.scrollTop = listRef.current.scrollHeight;
        }
      });
    };
    socket.onerror = () => {
      setStatus("Connection issue. Try again.");
    };
    socket.onclose = () => {
      if (sessionRef.current === sessionId) {
        socketRef.current = null;
      }
    };
    socketRef.current = socket;
    sessionRef.current = sessionId;
    return new Promise<WebSocket>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        reject(new Error("Socket timeout"));
      }, 3000);
      socket.addEventListener("open", () => {
        window.clearTimeout(timeoutId);
        resolve(socket);
      });
      socket.addEventListener("error", () => {
        window.clearTimeout(timeoutId);
        reject(new Error("Socket error"));
      });
    });
  };

  const resetSession = (nextPhone?: string) => {
    const selected = nextPhone ?? phoneNumber;
    setPhoneNumber(selected);
    setCallSessionId(null);
    setConfirmedSessionId(null);
    setMessages([
      {
        id: "intro",
        role: "agent",
        text: "Hi! This is PestCall. How can I help today?",
      },
    ]);
    setStatus("New session");
    socketRef.current?.close();
    socketRef.current = null;
    sessionRef.current = null;
  };

  const sendMessage = async (message: string) => {
    const trimmed = message.trim();
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
    responseIdRef.current = responseId;
    setMessages((prev) => [
      ...prev,
      { id: responseId, role: "agent", text: "" },
    ]);

    try {
      await ensureSocket(sessionId);
    } catch {
      setStatus("Connection issue. Try again.");
    }
    const base = apiBaseUrl || window.location.origin;
    try {
      const response = await fetch(new URL("/rpc/agent/message", base), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(demoAuthToken ? { "x-demo-auth": demoAuthToken } : {}),
        },
        body: JSON.stringify({
          json: {
            phoneNumber,
            text: trimmed,
            callSessionId: sessionId,
          },
          meta: [],
        }),
      });
      if (!response.ok) {
        throw new Error("Request failed");
      }
      const data = (await response.json()) as {
        json?: { callSessionId?: string; replyText?: string };
      };
      const replyText = data.json?.replyText ?? "";
      if (replyText) {
        const responseId = responseIdRef.current;
        if (responseId) {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === responseId && !message.text
                ? { ...message, text: replyText }
                : message,
            ),
          );
        }
      }
      if (data.json?.callSessionId) {
        setCallSessionId(data.json.callSessionId);
        setConfirmedSessionId(data.json.callSessionId);
      }
    } catch {
      setStatus("Connection issue. Try again.");
    }
  };

  const handleSend = () => {
    sendMessage(input);
  };

  const statusLabel = useMemo(() => {
    return status;
  }, [status]);

  const customers = customersQuery.data?.items ?? [];

  const selectedCustomer = useMemo(() => {
    return customers.find((option) => option.phoneE164 === phoneNumber) ?? null;
  }, [customers, phoneNumber]);

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
      <div className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[1.3fr_0.7fr]">
        <Card className="flex flex-col gap-6 animate-rise">
          <div className="flex items-start justify-between">
            <div>
              <Badge className="w-fit">Customer Portal</Badge>
              <h1 className="mt-3 text-3xl font-semibold text-ink sm:text-4xl">
                Talk to <span className="accent-text">PestCall</span>
              </h1>
              <p className="mt-2 text-sm text-ink/70">
                Fast answers for appointments, billing, and service updates.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="rounded-full border border-ink/10 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/60">
                {statusLabel}
              </span>
              {confirmedSessionId ? (
                <Link
                  href={`/agent/calls/${confirmedSessionId}`}
                  className="text-xs font-semibold uppercase tracking-wide text-ink/60 hover:text-ink"
                >
                  View in agent mode
                </Link>
              ) : null}
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
            className="scroll-area flex h-[min(60vh,520px)] flex-col gap-4 overflow-y-auto rounded-3xl border border-ink/10 bg-white/70 p-4 shadow-[inset_0_0_0_1px_rgba(12,27,31,0.04)]"
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
                className={`animate-rise max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  message.role === "customer"
                    ? "ml-auto bg-ink text-sand shadow-soft"
                    : "bg-sand text-ink shadow-soft"
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
            <div className="flex flex-col gap-3 sm:flex-row">
              <select
                id="customer-phone"
                className="flex-1 rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm"
                value={phoneNumber}
                onChange={(event) => resetSession(event.target.value)}
              >
                {customers.map((option) => (
                  <option key={option.id} value={option.phoneE164}>
                    {option.displayName} ({option.phoneE164})
                  </option>
                ))}
              </select>
              <Button type="button" onClick={() => resetSession()}>
                New session
              </Button>
            </div>
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
                className="flex-1 rounded-2xl border border-ink/15 bg-white/80 px-4 py-2 text-sm shadow-soft"
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

        <Card className="flex flex-col gap-5 animate-rise">
          <Badge className="w-fit">Customer Details</Badge>
          {selectedCustomer ? (
            <div className="space-y-4 text-sm text-ink/70">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink/50">
                  Name
                </p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {selectedCustomer.displayName}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink/50">
                  Phone
                </p>
                <p className="mt-1 text-sm text-ink">
                  {selectedCustomer.phoneE164}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink/50">
                  ZIP code
                </p>
                <p className="mt-1 text-sm text-ink">
                  {selectedCustomer.zipCode ?? "Unknown"}
                </p>
                {selectedCustomer.zipCode ? (
                  <Button
                    className="mt-2"
                    type="button"
                    onClick={() => sendMessage(selectedCustomer.zipCode ?? "")}
                  >
                    Send ZIP
                  </Button>
                ) : null}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink/50">
                  Address
                </p>
                <p className="mt-1 text-sm text-ink">
                  {selectedCustomer.addressSummary ?? "Unknown"}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink/60">No customers found yet.</p>
          )}
        </Card>
        <Card className="flex flex-col gap-5 animate-rise">
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

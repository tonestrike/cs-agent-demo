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

type ClientLog = {
  id: string;
  ts: string;
  message: string;
  data?: Record<string, unknown>;
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
  const [logsCopied, setLogsCopied] = useState(false);
  const [logs, setLogs] = useState<ClientLog[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScroll = useRef(true);
  const socketRef = useRef<WebSocket | null>(null);
  const responseIdRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const hasDeltaRef = useRef(false);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  const logEvent = (message: string, data?: Record<string, unknown>) => {
    const entry: ClientLog = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      message,
      data,
    };
    setLogs((prev) => [entry, ...prev].slice(0, 200));
  };

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
    url.pathname = `/api/conversations/${sessionId}/socket`;
    if (demoAuthToken) {
      url.searchParams.set("token", demoAuthToken);
    }
    return url.toString();
  };

  const ensureSocket = (sessionId: string) => {
    if (socketRef.current && sessionRef.current === sessionId) {
      if (socketRef.current.readyState === WebSocket.OPEN) {
        logEvent("ws.reuse.open", { sessionId });
        return Promise.resolve(socketRef.current);
      }
      logEvent("ws.reuse.wait", {
        sessionId,
        state: socketRef.current.readyState,
      });
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
          logEvent("ws.reuse.opened", { sessionId });
          resolve(socket);
        });
        socket.addEventListener("error", () => {
          window.clearTimeout(timeoutId);
          logEvent("ws.reuse.error", { sessionId });
          reject(new Error("Socket error"));
        });
      });
    }
    socketRef.current?.close();
    const socket = new WebSocket(buildWsUrl(sessionId));
    logEvent("ws.connect.start", { sessionId });
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as {
          type?: string;
          text?: string;
          data?: { callSessionId?: string; replyText?: string };
        };
        logEvent("ws.message", {
          sessionId,
          type: payload.type ?? "unknown",
          textLength: payload.text?.length ?? 0,
          hasData: Boolean(payload.data),
        });
        if (payload.type === "status") {
          const text = payload.text ?? "";
          if (text.trim()) {
            setStatus(text);
          }
          return;
        }
        if (payload.type === "token") {
          const text = payload.text ?? "";
          const responseId = responseIdRef.current;
          if (!responseId || !text) {
            return;
          }
          hasDeltaRef.current = true;
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
          return;
        }
        if (payload.type === "error") {
          const text = payload.text ?? "Something went wrong.";
          setStatus(text);
          return;
        }
      } catch {
        setStatus("Received malformed message.");
        logEvent("ws.message.parse_failed", { sessionId });
      }
      requestAnimationFrame(() => {
        if (shouldAutoScroll.current && listRef.current) {
          listRef.current.scrollTop = listRef.current.scrollHeight;
        }
      });
    };
    socket.onerror = () => {
      setStatus("Connection issue. Try again.");
      logEvent("ws.error", { sessionId });
    };
    socket.onclose = () => {
      if (sessionRef.current === sessionId) {
        socketRef.current = null;
      }
      logEvent("ws.close", { sessionId });
    };
    socketRef.current = socket;
    sessionRef.current = sessionId;
    return new Promise<WebSocket>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        logEvent("ws.connect.timeout", { sessionId });
        reject(new Error("Socket timeout"));
      }, 3000);
      socket.addEventListener("open", () => {
        window.clearTimeout(timeoutId);
        logEvent("ws.connect.open", { sessionId });
        resolve(socket);
      });
      socket.addEventListener("error", () => {
        window.clearTimeout(timeoutId);
        logEvent("ws.connect.error", { sessionId });
        reject(new Error("Socket error"));
      });
    });
  };

  const resetSession = (nextPhone?: string) => {
    const selected = nextPhone ?? phoneNumber;
    setPhoneNumber(selected);
    setCallSessionId(null);
    setConfirmedSessionId(null);
    hasDeltaRef.current = false;
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
    logEvent("session.reset", { phoneNumber: selected });
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
    logEvent("message.send.start", { sessionId, length: trimmed.length });
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "customer", text: trimmed },
    ]);
    setInput("");
    setStatus("Streaming reply...");

    const responseId = crypto.randomUUID();
    responseIdRef.current = responseId;
    hasDeltaRef.current = false;
    setMessages((prev) => [
      ...prev,
      { id: responseId, role: "agent", text: "" },
    ]);

    try {
      await ensureSocket(sessionId);
      logEvent("ws.ready", { sessionId });
    } catch {
      setStatus("Connection issue. Try again.");
      logEvent("ws.unavailable", { sessionId });
    }
    const base = apiBaseUrl || window.location.origin;
    try {
      logEvent("rpc.agent.message.start", { sessionId });
      const response = await fetch(
        new URL(`/api/conversations/${sessionId}/message`, base),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(demoAuthToken ? { "x-demo-auth": demoAuthToken } : {}),
          },
          body: JSON.stringify({
            phoneNumber,
            text: trimmed,
            callSessionId: sessionId,
          }),
        },
      );
      logEvent("rpc.agent.message.response", {
        sessionId,
        status: response.status,
      });
      if (!response.ok) {
        throw new Error("Request failed");
      }
      const data = (await response.json()) as {
        callSessionId?: string;
        replyText?: string;
      };
      const replyText = data.replyText ?? "";
      if (replyText && !hasDeltaRef.current) {
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
      if (data.callSessionId) {
        setCallSessionId(data.callSessionId);
        setConfirmedSessionId(data.callSessionId);
      }
      logEvent("rpc.agent.message.done", {
        sessionId,
        replyLength: replyText.length,
        usedFallback: !hasDeltaRef.current && Boolean(replyText),
      });
    } catch {
      setStatus("Connection issue. Try again.");
      logEvent("rpc.agent.message.failed", { sessionId });
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

  const copyClientLogs = async () => {
    const payload = {
      callSessionId,
      phoneNumber,
      logs,
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setLogsCopied(true);
    setTimeout(() => setLogsCopied(false), 1500);
  };

  return (
    <main className="grid-dots min-h-screen px-6 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
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

          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4 text-sm text-ink/70">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink/50">
                  Name
                </p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {selectedCustomer?.displayName ?? "Unknown"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink/50">
                  Phone
                </p>
                <p className="mt-1 text-sm text-ink">
                  {selectedCustomer?.phoneE164 ?? "Unknown"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink/50">
                  ZIP code
                </p>
                <p className="mt-1 text-sm text-ink">
                  {selectedCustomer?.zipCode ?? "Unknown"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink/50">
                  Address
                </p>
                <p className="mt-1 text-sm text-ink">
                  {selectedCustomer?.addressSummary ?? "Unknown"}
                </p>
              </div>
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
              <p className="text-xs text-ink/50">
                Keep the same session when testing follow-ups like “reschedule
                it.”
              </p>
            </div>
          </div>
        </Card>

        <div className="grid gap-8 lg:grid-cols-[1.3fr_0.7fr]">
          <Card className="flex flex-col gap-6 animate-rise">
            <Badge className="w-fit">Conversation</Badge>
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
                htmlFor="customer-message"
                className="text-xs uppercase tracking-wide text-ink/60"
              >
                Message
              </label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button onClick={handleSend}>Send</Button>
                  {selectedCustomer?.zipCode ? (
                    <Button
                      type="button"
                      onClick={() =>
                        sendMessage(selectedCustomer.zipCode ?? "")
                      }
                    >
                      Send ZIP
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </Card>
          <Card className="flex flex-col gap-5 animate-rise">
            <div className="flex items-center justify-between">
              <Badge className="w-fit">Client Log</Badge>
              <button
                type="button"
                onClick={copyClientLogs}
                className="text-xs font-semibold uppercase tracking-wide text-ink/50 hover:text-ink"
              >
                {logsCopied ? "Copied" : "Copy Logs"}
              </button>
            </div>
            <div className="max-h-[min(60vh,520px)] space-y-3 overflow-auto rounded-2xl border border-ink/10 bg-white/70 p-4 text-xs text-ink/70">
              {logs.length === 0 ? (
                <p className="text-ink/50">No client events yet.</p>
              ) : (
                logs.map((entry) => (
                  <div key={entry.id} className="space-y-1">
                    <p className="font-semibold text-ink">
                      {entry.ts} — {entry.message}
                    </p>
                    {entry.data ? (
                      <pre className="whitespace-pre-wrap text-[11px] text-ink/70">
                        {JSON.stringify(entry.data, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}

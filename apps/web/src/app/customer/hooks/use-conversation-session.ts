"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiBaseUrl, demoAuthToken } from "../../../lib/env";
import type { ChatMessage, ClientLog } from "../types";

export function useConversationSession(phoneNumber: string) {
  const [callSessionId, setCallSessionId] = useState<string | null>(null);
  const [confirmedSessionId, setConfirmedSessionId] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState("New session");
  const [logs, setLogs] = useState<ClientLog[]>([]);
  const [turnMetrics, setTurnMetrics] = useState<
    Array<{
      turnId: number;
      sessionId: string;
      userText: string;
      userTextLength: number;
      startedAt: number;
      firstTokenAt: number | null;
      firstStatusAt: number | null;
      finalAt: number | null;
      firstTokenMs: number | null;
      firstStatusMs: number | null;
      totalMs: number | null;
      statusTexts: string[];
    }>
  >([]);

  const socketRef = useRef<WebSocket | null>(null);
  const responseIdRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const hasDeltaRef = useRef(false);
  const autoZipTimerRef = useRef<number | null>(null);
  const pendingTurnsRef = useRef<
    Array<{ sessionId: string; startedAt: number; userText: string }>
  >([]);
  const turnMetricsRef = useRef(
    new Map<
      number,
      {
        turnId: number;
        sessionId: string;
        userText: string;
        userTextLength: number;
        startedAt: number;
        firstTokenAt: number | null;
        firstStatusAt: number | null;
        finalAt: number | null;
        firstTokenMs: number | null;
        firstStatusMs: number | null;
        totalMs: number | null;
        statusTexts: string[];
      }
    >(),
  );

  const clearAutoZipTimer = useCallback(() => {
    if (autoZipTimerRef.current !== null) {
      window.clearTimeout(autoZipTimerRef.current);
      autoZipTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearAutoZipTimer();
      socketRef.current?.close();
    };
  }, [clearAutoZipTimer]);

  const logEvent = useCallback(
    (message: string, data?: Record<string, unknown>) => {
      const entry: ClientLog = {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        message,
        data,
      };
      setLogs((prev) => [entry, ...prev].slice(0, 200));
    },
    [],
  );

  const syncTurnMetrics = useCallback(() => {
    const items = Array.from(turnMetricsRef.current.values()).sort(
      (a, b) => a.turnId - b.turnId,
    );
    setTurnMetrics(items);
  }, []);

  const ensureTurnMetric = useCallback(
    (turnId: number, sessionId: string) => {
      const existing = turnMetricsRef.current.get(turnId);
      if (existing) {
        return existing;
      }
      const pending = pendingTurnsRef.current.shift();
      const startedAt = pending?.startedAt ?? Date.now();
      const userText = pending?.userText ?? "";
      const metric = {
        turnId,
        sessionId,
        userText,
        userTextLength: userText.length,
        startedAt,
        firstTokenAt: null,
        firstStatusAt: null,
        finalAt: null,
        firstTokenMs: null,
        firstStatusMs: null,
        totalMs: null,
        statusTexts: [],
      };
      turnMetricsRef.current.set(turnId, metric);
      syncTurnMetrics();
      return metric;
    },
    [syncTurnMetrics],
  );

  const updateTurnMetric = useCallback(
    (
      turnId: number,
      sessionId: string,
      updater: (metric: {
        turnId: number;
        sessionId: string;
        userText: string;
        userTextLength: number;
        startedAt: number;
        firstTokenAt: number | null;
        firstStatusAt: number | null;
        finalAt: number | null;
        firstTokenMs: number | null;
        firstStatusMs: number | null;
        totalMs: number | null;
        statusTexts: string[];
      }) => void,
    ) => {
      const metric = ensureTurnMetric(turnId, sessionId);
      updater(metric);
      turnMetricsRef.current.set(turnId, { ...metric });
      syncTurnMetrics();
    },
    [ensureTurnMetric, syncTurnMetrics],
  );

  const buildWsUrl = useCallback((sessionId: string) => {
    const base = apiBaseUrl || window.location.origin;
    const url = new URL(base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/api/conversations/${sessionId}/socket`;
    if (demoAuthToken) {
      url.searchParams.set("token", demoAuthToken);
    }
    return url.toString();
  }, []);

  const ensureSocket = useCallback(
    (sessionId: string) => {
      if (socketRef.current && sessionRef.current === sessionId) {
        if (socketRef.current.readyState === WebSocket.OPEN) {
          logEvent("ws.reuse.open", { sessionId });
          setConnectionStatus("Connected");
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
            id?: number;
            seq?: number;
            turnId?: number;
            messageId?: string | null;
            role?: "assistant" | "system";
            correlationId?: string;
            type?: string;
            text?: string;
            data?: { callSessionId?: string; replyText?: string };
          };
          logEvent("ws.message", {
            sessionId,
            type: payload.type ?? "unknown",
            textLength: payload.text?.length ?? 0,
            hasData: Boolean(payload.data),
            turnId: payload.turnId,
            messageId: payload.messageId,
          });
          if (payload.type === "status") {
            const text = payload.text ?? "";
            if (text.trim()) {
              setMessages((prev) => {
                const statusId = `status-${payload.seq ?? payload.id ?? crypto.randomUUID()}`;
                return [...prev, { id: statusId, role: "status", text }];
              });
              if (typeof payload.turnId === "number") {
                updateTurnMetric(payload.turnId, sessionId, (metric) => {
                  const now = Date.now();
                  if (metric.firstStatusAt === null) {
                    metric.firstStatusAt = now;
                    metric.firstStatusMs = now - metric.startedAt;
                  }
                  metric.statusTexts = [...metric.statusTexts, text];
                });
              }
            }
            return;
          }
          if (payload.type === "token") {
            const text = payload.text ?? "";
            const messageId = payload.messageId ?? responseIdRef.current;
            if (!messageId || !text) {
              return;
            }
            if (typeof payload.turnId === "number") {
              updateTurnMetric(payload.turnId, sessionId, (metric) => {
                const now = Date.now();
                if (metric.firstTokenAt === null) {
                  metric.firstTokenAt = now;
                  metric.firstTokenMs = now - metric.startedAt;
                }
              });
            }
            hasDeltaRef.current = true;
            setMessages((prev) => {
              const exists = prev.some((message) => message.id === messageId);
              if (exists) {
                return prev.map((message) =>
                  message.id === messageId
                    ? { ...message, text: `${message.text}${text}` }
                    : message,
                );
              }
              return [...prev, { id: messageId, role: "agent", text }];
            });
            return;
          }
          if (payload.type === "final") {
            const data = payload.data;
            const replyText = data?.replyText ?? "";
            const messageId = payload.messageId ?? responseIdRef.current;
            if (messageId && replyText) {
              setMessages((prev) => {
                const exists = prev.some((message) => message.id === messageId);
                if (!exists) {
                  return [
                    ...prev,
                    { id: messageId, role: "agent", text: replyText },
                  ];
                }
                return prev.map((message) =>
                  message.id === messageId && !message.text
                    ? { ...message, text: replyText }
                    : message,
                );
              });
            }
            if (data?.callSessionId) {
              setCallSessionId(data.callSessionId);
              setConfirmedSessionId(data.callSessionId);
            }
            if (typeof payload.turnId === "number") {
              updateTurnMetric(payload.turnId, sessionId, (metric) => {
                const now = Date.now();
                if (metric.finalAt === null) {
                  metric.finalAt = now;
                  metric.totalMs = now - metric.startedAt;
                }
              });
            }
            return;
          }
          if (payload.type === "error") {
            setConnectionStatus("Connection issue. Try again.");
            return;
          }
        } catch {
          setConnectionStatus("Connection issue. Try again.");
          logEvent("ws.message.parse_failed", { sessionId });
        }
      };
      socket.onerror = () => {
        setConnectionStatus("Connection issue. Try again.");
        logEvent("ws.error", { sessionId });
      };
      socket.onclose = () => {
        setConnectionStatus("Disconnected");
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
          setConnectionStatus("Connected");
          resolve(socket);
        });
        socket.addEventListener("error", () => {
          window.clearTimeout(timeoutId);
          setConnectionStatus("Connection issue. Try again.");
          logEvent("ws.connect.error", { sessionId });
          reject(new Error("Socket error"));
        });
      });
    },
    [buildWsUrl, logEvent, updateTurnMetric],
  );

  const resetSession = useCallback(() => {
    setCallSessionId(null);
    setConfirmedSessionId(null);
    hasDeltaRef.current = false;
    setMessages([]);
    setConnectionStatus("New session");
    pendingTurnsRef.current = [];
    turnMetricsRef.current.clear();
    setTurnMetrics([]);
    socketRef.current?.close();
    socketRef.current = null;
    sessionRef.current = null;
    clearAutoZipTimer();
    logEvent("session.reset", { phoneNumber });
  }, [phoneNumber, logEvent, clearAutoZipTimer]);

  const sendMessage = useCallback(
    async (
      message: string,
      options?: { skipUserMessage?: boolean; userMessageText?: string },
    ) => {
      const trimmed = message.trim();
      if (!trimmed) {
        return;
      }
      const sessionId = callSessionId ?? crypto.randomUUID();
      if (!callSessionId) {
        setCallSessionId(sessionId);
      }
      logEvent("message.send.start", { sessionId, length: trimmed.length });
      if (!options?.skipUserMessage) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "customer",
            text: options?.userMessageText ?? trimmed,
          },
        ]);
      }
      const pendingEntry = {
        sessionId,
        startedAt: Date.now(),
        userText: options?.userMessageText ?? trimmed,
      };
      pendingTurnsRef.current.push(pendingEntry);

      const responseId = crypto.randomUUID();
      responseIdRef.current = responseId;
      hasDeltaRef.current = false;

      try {
        setConnectionStatus("Connecting");
        await ensureSocket(sessionId);
        logEvent("ws.ready", { sessionId });
      } catch {
        setConnectionStatus("Connection issue. Try again.");
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
        };
        if (data.callSessionId) {
          setCallSessionId(data.callSessionId);
          setConfirmedSessionId(data.callSessionId);
        }
        logEvent("rpc.agent.message.done", {
          sessionId,
          replyLength: 0,
          usedFallback: false,
        });
      } catch {
        setConnectionStatus("Connection issue. Try again.");
        logEvent("rpc.agent.message.failed", { sessionId });
        const pendingTurns = pendingTurnsRef.current;
        const entryIndex = pendingTurns.lastIndexOf(pendingEntry);
        if (entryIndex >= 0) {
          pendingTurns.splice(entryIndex, 1);
        }
      }
    },
    [callSessionId, phoneNumber, ensureSocket, logEvent],
  );

  const startCall = useCallback(
    async (zip?: string) => {
      if (!phoneNumber) {
        return;
      }
      logEvent("chat.start_call", { phoneNumber });
      clearAutoZipTimer();
      await sendMessage("Incoming call started", { skipUserMessage: true });
      const normalizedZip = zip?.trim();
      if (!normalizedZip) {
        return;
      }
      const DELAY_MS = 2500;
      autoZipTimerRef.current = window.setTimeout(() => {
        autoZipTimerRef.current = null;
        logEvent("chat.auto_zip", { phoneNumber });
        void sendMessage(normalizedZip);
      }, DELAY_MS);
    },
    [clearAutoZipTimer, logEvent, phoneNumber, sendMessage],
  );

  return {
    messages,
    status: connectionStatus,
    logs,
    turnMetrics,
    confirmedSessionId,
    callSessionId,
    sendMessage,
    startCall,
    resetSession,
  };
}

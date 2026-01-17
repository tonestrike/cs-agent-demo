"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiBaseUrl, demoAuthToken } from "../../../lib/env";
import type { ChatMessage, ClientLog } from "../types";

const INITIAL_MESSAGE: ChatMessage = {
  id: "intro",
  role: "agent",
  text: "Hi! This is PestCall. How can I help today?",
};

export function useConversationSession(phoneNumber: string) {
  const [callSessionId, setCallSessionId] = useState<string | null>(null);
  const [confirmedSessionId, setConfirmedSessionId] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [status, setStatus] = useState("New session");
  const [logs, setLogs] = useState<ClientLog[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const responseIdRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const hasDeltaRef = useRef(false);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

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
    },
    [buildWsUrl, logEvent],
  );

  const resetSession = useCallback(() => {
    setCallSessionId(null);
    setConfirmedSessionId(null);
    hasDeltaRef.current = false;
    setMessages([INITIAL_MESSAGE]);
    setStatus("New session");
    socketRef.current?.close();
    socketRef.current = null;
    sessionRef.current = null;
    logEvent("session.reset", { phoneNumber });
  }, [phoneNumber, logEvent]);

  const sendMessage = useCallback(
    async (message: string) => {
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
          const currentResponseId = responseIdRef.current;
          if (currentResponseId) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === currentResponseId && !msg.text
                  ? { ...msg, text: replyText }
                  : msg,
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
    },
    [callSessionId, phoneNumber, ensureSocket, logEvent],
  );

  return {
    messages,
    status,
    logs,
    confirmedSessionId,
    callSessionId,
    sendMessage,
    resetSession,
  };
}

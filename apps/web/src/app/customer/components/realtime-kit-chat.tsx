"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RTKClientOptions } from "@cloudflare/realtimekit";
import type { Meeting } from "@cloudflare/realtimekit-ui";
import { apiBaseUrl, demoAuthToken } from "../../../lib/env";
import type { Customer } from "../types";

type RealtimeKitClient = Meeting & {
  join: () => Promise<void>;
  leave: () => Promise<void>;
  self?: { userId?: string };
  chat?: RealtimeKitChat;
  ai?: {
    on?: (
      event: "transcript",
      handler: (event: RealtimeKitTranscriptEvent) => void,
    ) => void;
    off?: (
      event: "transcript",
      handler: (event: RealtimeKitTranscriptEvent) => void,
    ) => void;
  };
};

type RealtimeKitChatMessage = {
  id?: string;
  type?: string;
  userId?: string;
  message?: string;
};

type RealtimeKitChatEvent =
  | { detail?: { message?: RealtimeKitChatMessage } }
  | { message?: RealtimeKitChatMessage };

type RealtimeKitChat = {
  addListener: (
    event: "chatUpdate",
    handler: (event: RealtimeKitChatEvent) => void,
  ) => void;
  removeListener: (
    event: "chatUpdate",
    handler: (event: RealtimeKitChatEvent) => void,
  ) => void;
};

type RealtimeKitTranscriptEvent = {
  id?: string;
  userId?: string;
  customParticipantId?: string;
  transcript?: string;
  isPartialTranscript?: boolean;
};

declare global {
  interface Window {
    RealtimeKit?: {
      init?: (options: {
        authToken: string;
        defaults?: { audio?: boolean; video?: boolean };
        modules?: RTKClientOptions["modules"];
      }) => Promise<RealtimeKitClient>;
    };
  }
}

type RealtimeKitTokenResponse = {
  ok: boolean;
  meetingId: string;
  authToken: string;
  token?: string;
  participantId: string;
  presetName?: string | null;
  expiresAt?: string | null;
  error?: string;
};

interface PreloadState {
  status: string;
  error?: string;
}

interface RealtimeKitChatPanelProps {
  sessionId: string | null;
  customer?: Customer | null;
  enableTts?: boolean;
}

export function RealtimeKitChatPanel({
  sessionId,
  customer,
  enableTts = false,
}: RealtimeKitChatPanelProps) {
  const [status, setStatus] = useState<PreloadState>({
    status: "Waiting for session...",
  });
  const [meeting, setMeeting] = useState<RealtimeKitClient | null>(null);
  const meetingRef = useRef<RealtimeKitClient | null>(null);
  const chatElementRef = useRef<HTMLRtkChatElement | null>(null);
  const micToggleRef = useRef<HTMLRtkMicToggleElement | null>(null);
  const sentMessageIds = useRef(new Set<string>());
  const retryTimerRef = useRef<number | null>(null);
  const assistantBuffersRef = useRef(new Map<string, string>());
  const ttsEnabledRef = useRef(enableTts);
  const [partialTranscript, setPartialTranscript] = useState<string | null>(
    null,
  );
  const [finalTranscripts, setFinalTranscripts] = useState<
    Array<{ id: string; text: string }>
  >([]);

  const sendToConversation = useCallback(
    async (text: string, source: string) => {
      if (!sessionId || !customer) {
        return;
      }
      const base = apiBaseUrl || window.location.origin;
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (demoAuthToken) {
        headers["x-demo-auth"] = demoAuthToken;
      }
      try {
        await fetch(`${base}/api/conversations/${sessionId}/message`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            phoneNumber: customer.phoneE164,
            text,
            callSessionId: sessionId,
            source,
          }),
        });
      } catch (error) {
        console.error("rtk message send failed", error);
      }
    },
    [customer, sessionId],
  );

  useEffect(() => {
    ttsEnabledRef.current = enableTts;
  }, [enableTts]);

  useEffect(() => {
    let cancelled = false;
    const cleanup = () => {
      const client = meetingRef.current;
      if (client) {
        // Allow RTK web components to detach listeners before tearing down.
        window.setTimeout(() => {
          client.leave().catch(() => {});
        }, 0);
        meetingRef.current = null;
      }
      setMeeting(null);
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    if (!sessionId || !customer) {
      cleanup();
      setStatus({ status: "Waiting for conversation session..." });
      return;
    }

    const loadRealtimeKit = async () => {
      setStatus({ status: "Requesting realtime token..." });
      const base = apiBaseUrl || window.location.origin;
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (demoAuthToken) {
        headers["x-demo-auth"] = demoAuthToken;
      }
      const response = await fetch(
        `${base}/api/conversations/${sessionId}/rtk-token`,
        {
          method: "POST",
          headers,
        },
      );
      const payload = (await response.json()) as RealtimeKitTokenResponse;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "RealtimeKit token request failed");
      }
      const authToken = payload.authToken ?? payload.token;
      if (!authToken) {
        throw new Error("RealtimeKit token missing");
      }
      const RealtimeKit = window.RealtimeKit;
      if (!RealtimeKit || typeof RealtimeKit.init !== "function") {
        throw new Error("RealtimeKit SDK unavailable");
      }
      setStatus({ status: "Joining realtime meeting..." });
      const client = await RealtimeKit.init({
        authToken,
        defaults: { audio: true, video: false },
        modules: { chat: true, participant: true },
      });
      await client.join();
      if (cancelled) {
        await client.leave();
        return;
      }
      meetingRef.current = client;
      setMeeting(client);
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      setStatus({ status: "RealtimeKit chat ready" });
    };

    const handleFailure = (error: unknown) => {
      if (cancelled) {
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : "RealtimeKit token request failed";
      setStatus({ status: "RealtimeKit unavailable", error: message });
      scheduleRetry();
    };

    const startLoad = () => {
      void loadRealtimeKit().catch(handleFailure);
    };

    function scheduleRetry() {
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
      }
      const DELAY_MS = 2500;
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        if (cancelled) {
          return;
        }
        startLoad();
      }, DELAY_MS);
    }

    startLoad();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [sessionId, customer]);

  useEffect(() => {
    if (!meeting || !sessionId || !customer) {
      return;
    }
    const chat = meeting.chat;
    if (!chat?.addListener || !chat?.removeListener) {
      return;
    }
    const handleChatUpdate = (event: RealtimeKitChatEvent) => {
      const detail = "detail" in event ? event.detail : event;
      const message =
        detail && "message" in detail ? detail.message : undefined;
      if (!message || !message.id || message.type !== "chat") {
        return;
      }
      const selfUserId = meeting.self?.userId;
      if (message.userId !== selfUserId) {
        return;
      }
      if (sentMessageIds.current.has(message.id)) {
        return;
      }
      const text = message.message?.trim();
      if (!text) {
        return;
      }
      sentMessageIds.current.add(message.id);
      void sendToConversation(text, "rtk_chat");
    };
    chat.addListener("chatUpdate", handleChatUpdate);
    return () => {
      chat.removeListener("chatUpdate", handleChatUpdate);
    };
  }, [meeting, sessionId, customer, sendToConversation]);

  useEffect(() => {
    if (!meeting || !sessionId || !customer) {
      return;
    }
    const ai = meeting.ai;
    const aiOn = ai?.on;
    const aiOff = ai?.off;
    if (!aiOn || !aiOff) {
      return;
    }
    const localUserId = meeting.self?.userId;
    const handleTranscript = (event: RealtimeKitTranscriptEvent) => {
      const text = event.transcript?.trim();
      if (!text) {
        return;
      }
      const isLocal =
        !localUserId || !event.userId ? true : event.userId === localUserId;
      if (!isLocal) {
        return;
      }
      if (event.isPartialTranscript) {
        setPartialTranscript(text);
        return;
      }
      setPartialTranscript(null);
      setFinalTranscripts((prev) =>
        [...prev, { id: crypto.randomUUID(), text }].slice(-4),
      );
      void sendToConversation(text, "rtk_transcript");
    };
    aiOn("transcript", handleTranscript);
    return () => {
      aiOff("transcript", handleTranscript);
    };
  }, [meeting, sessionId, customer, sendToConversation]);

  useEffect(() => {
    if (!sessionId || !customer) {
      return;
    }
    const base = apiBaseUrl || window.location.origin;
    const url = new URL(base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/api/conversations/${sessionId}/socket`;
    if (demoAuthToken) {
      url.searchParams.set("token", demoAuthToken);
    }
    const socket = new WebSocket(url.toString());
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as {
          type?: string;
          messageId?: string | null;
          role?: "assistant" | "system";
          text?: string;
          data?: { replyText?: string };
        };
        if (payload.role === "system") {
          return;
        }
        if (payload.type === "token") {
          const messageId = payload.messageId ?? "default";
          const current = assistantBuffersRef.current.get(messageId) ?? "";
          assistantBuffersRef.current.set(
            messageId,
            `${current}${payload.text ?? ""}`,
          );
          return;
        }
        if (payload.type === "final") {
          const messageId = payload.messageId ?? "default";
          const buffer = assistantBuffersRef.current.get(messageId) ?? "";
          assistantBuffersRef.current.delete(messageId);
          const text = payload.data?.replyText ?? buffer;
          if (!text || !ttsEnabledRef.current) {
            return;
          }
          const utterance = new SpeechSynthesisUtterance(text);
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        }
      } catch {
        // Ignore malformed events; TTS should be best-effort.
      }
    };
    return () => {
      socket.close();
    };
  }, [sessionId, customer]);

  useEffect(() => {
    const element = chatElementRef.current;
    if (!element || !meeting) {
      return;
    }
    element.meeting = meeting;
  }, [meeting]);

  useEffect(() => {
    const element = micToggleRef.current;
    if (!element || !meeting) {
      return;
    }
    element.meeting = meeting;
  }, [meeting]);

  const handleChatRef = useCallback(
    (element: HTMLRtkChatElement | null) => {
      chatElementRef.current = element;
      if (element && meeting) {
        element.meeting = meeting;
      }
    },
    [meeting],
  );

  const handleMicToggleRef = useCallback(
    (element: HTMLRtkMicToggleElement | null) => {
      micToggleRef.current = element;
      if (element && meeting) {
        element.meeting = meeting;
      }
    },
    [meeting],
  );

  return (
    <div className="rounded-xl border border-ink-200 bg-white shadow-soft">
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-ink">RealtimeKit chat</h3>
          {meeting && <rtk-mic-toggle ref={handleMicToggleRef} size="sm" />}
        </div>
        <span className="text-xs text-ink/70" title={status.error ?? undefined}>
          {status.status}
        </span>
      </div>
      {(partialTranscript || finalTranscripts.length > 0) && (
        <div className="border-b border-ink-100 bg-sand-50 px-4 py-2 text-xs text-ink-600">
          {finalTranscripts.length > 0 && (
            <div className="space-y-1">
              {finalTranscripts.map((line) => (
                <p key={line.id}>You: {line.text}</p>
              ))}
            </div>
          )}
          {partialTranscript && (
            <p className="italic text-ink-500">
              Listening… {partialTranscript}
            </p>
          )}
        </div>
      )}
      <div className="h-[360px] bg-sand-50">
        {meeting ? (
          <div className="h-full">
            <rtk-chat
              ref={handleChatRef}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-sm text-ink/70">
            {sessionId
              ? status.status
              : "Send a message to establish a session before realtime chat loads."}
          </div>
        )}
      </div>
    </div>
  );
}

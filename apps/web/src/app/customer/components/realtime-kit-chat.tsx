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
  participants?: RealtimeKitParticipants;
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

type RealtimeKitParticipants = {
  addListener: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (
    event: string,
    handler: (...args: unknown[]) => void,
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
      }) => Promise<unknown>;
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
  const [meetingReady, setMeetingReady] = useState(false);
  const meetingRef = useRef<RealtimeKitClient | null>(null);
  const chatElementRef = useRef<HTMLRtkChatElement | null>(null);
  const micToggleRef = useRef<HTMLRtkMicToggleElement | null>(null);
  const sentMessageIds = useRef(new Set<string>());
  const retryTimerRef = useRef<number | null>(null);
  const chatReadyTimerRef = useRef<number | null>(null);
  const uiReadyTimerRef = useRef<number | null>(null);
  const boundEmittersRef = useRef(new WeakSet<object>());
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
        // Clear refs before leaving to avoid stale references.
        meetingRef.current = null;
        // Leave the meeting; the web components will handle their own cleanup
        // when they detect the meeting state change or unmount.
        client.leave().catch(() => {});
      }
      setMeeting(null);
      setMeetingReady(false);
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (chatReadyTimerRef.current) {
        window.clearTimeout(chatReadyTimerRef.current);
        chatReadyTimerRef.current = null;
      }
      if (uiReadyTimerRef.current) {
        window.clearTimeout(uiReadyTimerRef.current);
        uiReadyTimerRef.current = null;
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
      const client = (await RealtimeKit.init({
        authToken,
        defaults: { audio: true, video: false },
        modules: { chat: true, participant: true },
      })) as RealtimeKitClient;
      await client.join();
      if (cancelled) {
        await client.leave();
        return;
      }
      meetingRef.current = client;
      setMeeting(client);
      setMeetingReady(false);
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
      setMeetingReady(false);
      return;
    }
    let cancelled = false;
    const bindEmitter = (candidate: unknown) => {
      if (!candidate || typeof candidate !== "object") {
        return;
      }
      if (boundEmittersRef.current.has(candidate)) {
        return;
      }
      const emitter = candidate as {
        addListener?: (...args: unknown[]) => unknown;
        removeListener?: (...args: unknown[]) => unknown;
      };
      if (typeof emitter.addListener === "function") {
        try {
          emitter.addListener = emitter.addListener.bind(candidate);
        } catch {}
      }
      if (typeof emitter.removeListener === "function") {
        try {
          emitter.removeListener = emitter.removeListener.bind(candidate);
        } catch {}
      }
      boundEmittersRef.current.add(candidate);
    };
    const isEmitterReady = (candidate: unknown) => {
      if (!candidate || typeof candidate !== "object") {
        return false;
      }
      const emitter = candidate as { _events?: unknown };
      return typeof emitter._events !== "undefined";
    };
    const checkReady = () => {
      if (cancelled) {
        return;
      }
      const chat = meeting.chat;
      const participants = meeting.participants;
      if (chat) {
        bindEmitter(chat);
      }
      if (participants) {
        bindEmitter(participants);
      }
      if (
        chat &&
        participants &&
        isEmitterReady(chat) &&
        isEmitterReady(participants)
      ) {
        setMeetingReady(true);
        return;
      }
      uiReadyTimerRef.current = window.setTimeout(checkReady, 100);
    };
    checkReady();
    return () => {
      cancelled = true;
      if (uiReadyTimerRef.current) {
        window.clearTimeout(uiReadyTimerRef.current);
        uiReadyTimerRef.current = null;
      }
    };
  }, [meeting, sessionId, customer]);

  useEffect(() => {
    if (!meeting || !meetingReady || !sessionId || !customer) {
      return;
    }
    let cancelled = false;
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

    const attachChatListener = () => {
      if (cancelled) {
        return;
      }
      const chat = meeting.chat;
      const emitterReady =
        chat && typeof (chat as { _events?: unknown })._events !== "undefined";
      if (!chat || !emitterReady) {
        chatReadyTimerRef.current = window.setTimeout(attachChatListener, 100);
        return;
      }
      try {
        chat.addListener("chatUpdate", handleChatUpdate);
      } catch {
        chatReadyTimerRef.current = window.setTimeout(attachChatListener, 100);
      }
    };

    attachChatListener();
    return () => {
      cancelled = true;
      const chat = meeting.chat;
      if (chat?.removeListener) {
        try {
          chat.removeListener("chatUpdate", handleChatUpdate);
        } catch {
          // Emitter may already be destroyed; ignore cleanup errors.
        }
      }
      if (chatReadyTimerRef.current) {
        window.clearTimeout(chatReadyTimerRef.current);
        chatReadyTimerRef.current = null;
      }
    };
  }, [meeting, meetingReady, sessionId, customer, sendToConversation]);

  useEffect(() => {
    if (!meeting || !meetingReady || !sessionId || !customer) {
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
    try {
      aiOn("transcript", handleTranscript);
    } catch {
      // ai module may not be fully initialized; ignore.
      return;
    }
    return () => {
      try {
        aiOff("transcript", handleTranscript);
      } catch {
        // ai module may already be destroyed; ignore.
      }
    };
  }, [meeting, meetingReady, sessionId, customer, sendToConversation]);

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
    if (!element || !meeting || !meetingReady) {
      return;
    }
    let cancelled = false;
    let timerId: number | null = null;
    let retries = 0;
    const MAX_RETRIES = 20;
    const tryAssign = () => {
      if (cancelled) return;
      try {
        element.meeting = meeting;
      } catch (err) {
        retries++;
        if (retries < MAX_RETRIES) {
          // RTK component may not be ready; retry after a short delay.
          timerId = window.setTimeout(tryAssign, 50);
        } else {
          console.warn("rtk-chat: failed to assign meeting after retries", err);
        }
      }
    };
    // Delay initial assignment to allow web component to fully mount.
    timerId = window.setTimeout(tryAssign, 0);
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [meeting, meetingReady]);

  useEffect(() => {
    const element = micToggleRef.current;
    if (!element || !meeting || !meetingReady) {
      return;
    }
    let cancelled = false;
    let timerId: number | null = null;
    let retries = 0;
    const MAX_RETRIES = 20;
    const tryAssign = () => {
      if (cancelled) return;
      try {
        element.meeting = meeting;
      } catch (err) {
        retries++;
        if (retries < MAX_RETRIES) {
          // RTK component may not be ready; retry after a short delay.
          timerId = window.setTimeout(tryAssign, 50);
        } else {
          console.warn(
            "rtk-mic-toggle: failed to assign meeting after retries",
            err,
          );
        }
      }
    };
    timerId = window.setTimeout(tryAssign, 0);
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [meeting, meetingReady]);

  const handleChatRef = useCallback((element: HTMLRtkChatElement | null) => {
    chatElementRef.current = element;
    // Assignment is handled by the useEffect above to avoid race conditions.
  }, []);

  const handleMicToggleRef = useCallback(
    (element: HTMLRtkMicToggleElement | null) => {
      micToggleRef.current = element;
      // Assignment is handled by the useEffect above to avoid race conditions.
    },
    [],
  );

  return (
    <div className="flex h-full flex-col rounded-xl border border-ink-200 bg-white shadow-soft">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-100 px-4 py-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-ink">RealtimeKit chat</h3>
          {meetingReady && (
            <rtk-mic-toggle ref={handleMicToggleRef} size="sm" />
          )}
        </div>
        <span className="text-xs text-ink/70" title={status.error ?? undefined}>
          {status.status}
        </span>
      </div>
      {(partialTranscript || finalTranscripts.length > 0) && (
        <div className="flex-shrink-0 border-b border-ink-100 bg-sand-50 px-4 py-2 text-xs text-ink-600">
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
      <div className="min-h-0 flex-1 bg-sand-50">
        {meetingReady ? (
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

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RTKClientOptions } from "@cloudflare/realtimekit";
import type { Meeting } from "@cloudflare/realtimekit-ui";
import { apiBaseUrl, demoAuthToken } from "../../../lib/env";
import type { Customer } from "../types";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type RealtimeKitClient = Meeting & {
  join: () => Promise<void>;
  leave: () => Promise<void>;
  self?: { userId?: string };
  chat?: RealtimeKitChat;
  participants?: RealtimeKitParticipants;
  ai?: {
    on?: (
      event: "transcript",
      handler: (event: TranscriptEvent) => void,
    ) => void;
    off?: (
      event: "transcript",
      handler: (event: TranscriptEvent) => void,
    ) => void;
  };
};

type RealtimeKitChat = {
  addListener: (event: "chatUpdate", handler: (e: ChatEvent) => void) => void;
  removeListener: (
    event: "chatUpdate",
    handler: (e: ChatEvent) => void,
  ) => void;
};

type RealtimeKitParticipants = {
  addListener: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (
    event: string,
    handler: (...args: unknown[]) => void,
  ) => void;
};

type ChatMessage = {
  id?: string;
  type?: string;
  userId?: string;
  message?: string;
};

type ChatEvent =
  | { detail?: { message?: ChatMessage } }
  | { message?: ChatMessage };

type TranscriptEvent = {
  id?: string;
  userId?: string;
  customParticipantId?: string;
  transcript?: string;
  isPartialTranscript?: boolean;
};

type TokenResponse = {
  ok: boolean;
  meetingId: string;
  authToken: string;
  token?: string;
  participantId: string;
  presetName?: string | null;
  expiresAt?: string | null;
  error?: string;
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

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function getApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (demoAuthToken) headers["x-demo-auth"] = demoAuthToken;
  return headers;
}

function getBaseUrl(): string {
  return apiBaseUrl || window.location.origin;
}

function isEmitterReady(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  return (
    "_events" in obj && (obj as { _events?: unknown })._events !== undefined
  );
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

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
  const [status, setStatus] = useState("Waiting for session...");
  const [statusError, setStatusError] = useState<string | undefined>();
  const [meeting, setMeeting] = useState<RealtimeKitClient | null>(null);
  const [meetingReady, setMeetingReady] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState<string | null>(
    null,
  );
  const [finalTranscripts, setFinalTranscripts] = useState<
    Array<{ id: string; text: string }>
  >([]);

  const meetingRef = useRef<RealtimeKitClient | null>(null);
  const chatElementRef = useRef<HTMLRtkChatElement | null>(null);
  const micToggleRef = useRef<HTMLRtkMicToggleElement | null>(null);
  const sentMessageIds = useRef(new Set<string>());
  const assistantBuffers = useRef(new Map<string, string>());
  const ttsEnabled = useRef(enableTts);
  const timers = useRef<{
    retry?: number;
    chatReady?: number;
    uiReady?: number;
  }>({});

  // Keep ttsEnabled ref in sync
  useEffect(() => {
    ttsEnabled.current = enableTts;
  }, [enableTts]);

  // Send message to conversation API
  const sendToConversation = useCallback(
    async (text: string, source: string) => {
      if (!sessionId || !customer) return;
      try {
        await fetch(`${getBaseUrl()}/api/conversations/${sessionId}/message`, {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify({
            phoneNumber: customer.phoneE164,
            text,
            callSessionId: sessionId,
            source,
          }),
        });
      } catch (err) {
        console.error("rtk message send failed", err);
      }
    },
    [customer, sessionId],
  );

  // Clear all timers
  const clearTimers = useCallback(() => {
    if (timers.current.retry) window.clearTimeout(timers.current.retry);
    if (timers.current.chatReady) window.clearTimeout(timers.current.chatReady);
    if (timers.current.uiReady) window.clearTimeout(timers.current.uiReady);
    timers.current = {};
  }, []);

  // Main effect: Initialize and manage meeting lifecycle
  useEffect(() => {
    let cancelled = false;

    const cleanup = () => {
      const client = meetingRef.current;
      if (client) {
        meetingRef.current = null;
        client.leave().catch(() => {});
      }
      setMeeting(null);
      setMeetingReady(false);
      clearTimers();
    };

    if (!sessionId || !customer) {
      cleanup();
      setStatus("Waiting for conversation session...");
      return;
    }

    const loadMeeting = async () => {
      setStatus("Requesting realtime token...");
      const response = await fetch(
        `${getBaseUrl()}/api/conversations/${sessionId}/rtk-token`,
        { method: "POST", headers: getApiHeaders() },
      );
      const payload = (await response.json()) as TokenResponse;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "RealtimeKit token request failed");
      }

      const authToken = payload.authToken ?? payload.token;
      if (!authToken) throw new Error("RealtimeKit token missing");

      const sdk = window.RealtimeKit;
      if (!sdk?.init) throw new Error("RealtimeKit SDK unavailable");

      setStatus("Joining realtime meeting...");
      const client = (await sdk.init({
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
      setStatus("RealtimeKit chat ready");
    };

    const scheduleRetry = () => {
      timers.current.retry = window.setTimeout(() => {
        if (!cancelled) void loadMeeting().catch(handleError);
      }, 2500);
    };

    const handleError = (err: unknown) => {
      if (cancelled) return;
      const message = err instanceof Error ? err.message : "Connection failed";
      setStatus("RealtimeKit unavailable");
      setStatusError(message);
      scheduleRetry();
    };

    void loadMeeting().catch(handleError);

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [sessionId, customer, clearTimers]);

  // Wait for meeting emitters to be ready before enabling UI
  useEffect(() => {
    if (!meeting) {
      setMeetingReady(false);
      return;
    }

    let cancelled = false;
    const checkReady = () => {
      if (cancelled) return;
      const { chat, participants } = meeting;
      if (
        chat &&
        participants &&
        isEmitterReady(chat) &&
        isEmitterReady(participants)
      ) {
        setMeetingReady(true);
      } else {
        timers.current.uiReady = window.setTimeout(checkReady, 100);
      }
    };
    checkReady();

    return () => {
      cancelled = true;
      if (timers.current.uiReady) {
        window.clearTimeout(timers.current.uiReady);
        timers.current.uiReady = undefined;
      }
    };
  }, [meeting]);

  // Listen for chat messages from the local user
  useEffect(() => {
    if (!meeting || !meetingReady) return;

    let cancelled = false;
    const handleChatUpdate = (event: ChatEvent) => {
      const detail = "detail" in event ? event.detail : event;
      const msg = detail && "message" in detail ? detail.message : undefined;
      if (!msg?.id || msg.type !== "chat") return;
      if (msg.userId !== meeting.self?.userId) return;
      if (sentMessageIds.current.has(msg.id)) return;

      const text = msg.message?.trim();
      if (!text) return;

      sentMessageIds.current.add(msg.id);
      void sendToConversation(text, "rtk_chat");
    };

    const attach = () => {
      if (cancelled) return;
      const { chat } = meeting;
      if (!chat || !isEmitterReady(chat)) {
        timers.current.chatReady = window.setTimeout(attach, 100);
        return;
      }
      try {
        chat.addListener("chatUpdate", handleChatUpdate);
      } catch {
        timers.current.chatReady = window.setTimeout(attach, 100);
      }
    };
    attach();

    return () => {
      cancelled = true;
      if (timers.current.chatReady) {
        window.clearTimeout(timers.current.chatReady);
        timers.current.chatReady = undefined;
      }
      try {
        meeting.chat?.removeListener("chatUpdate", handleChatUpdate);
      } catch {
        // Ignore cleanup errors
      }
    };
  }, [meeting, meetingReady, sendToConversation]);

  // Listen for voice transcripts
  useEffect(() => {
    if (!meeting || !meetingReady) return;

    const { ai } = meeting;
    if (!ai?.on || !ai?.off) return;

    const localUserId = meeting.self?.userId;
    const handleTranscript = (event: TranscriptEvent) => {
      const text = event.transcript?.trim();
      if (!text) return;

      const isLocal =
        !localUserId || !event.userId || event.userId === localUserId;
      if (!isLocal) return;

      if (event.isPartialTranscript) {
        setPartialTranscript(text);
      } else {
        setPartialTranscript(null);
        setFinalTranscripts((prev) =>
          [...prev, { id: crypto.randomUUID(), text }].slice(-4),
        );
        void sendToConversation(text, "rtk_transcript");
      }
    };

    try {
      ai.on("transcript", handleTranscript);
    } catch {
      return;
    }

    return () => {
      try {
        ai.off("transcript", handleTranscript);
      } catch {
        // Ignore cleanup errors
      }
    };
  }, [meeting, meetingReady, sendToConversation]);

  // WebSocket for TTS playback of assistant responses
  useEffect(() => {
    if (!sessionId || !customer) return;

    const url = new URL(getBaseUrl());
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/api/conversations/${sessionId}/socket`;
    if (demoAuthToken) url.searchParams.set("token", demoAuthToken);

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

        // Handle status events for TTS - speak them immediately
        if (payload.type === "status") {
          const text = payload.text?.trim();
          if (text && ttsEnabled.current) {
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
          }
          return;
        }

        // Skip other system messages
        if (payload.role === "system") return;

        const messageId = payload.messageId ?? "default";
        if (payload.type === "token") {
          const current = assistantBuffers.current.get(messageId) ?? "";
          assistantBuffers.current.set(
            messageId,
            current + (payload.text ?? ""),
          );
        } else if (payload.type === "final") {
          const buffer = assistantBuffers.current.get(messageId) ?? "";
          assistantBuffers.current.delete(messageId);
          const text = payload.data?.replyText ?? buffer;
          if (text && ttsEnabled.current) {
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    return () => socket.close();
  }, [sessionId, customer]);

  // Assign meeting to RTK web components with retry logic
  useEffect(() => {
    if (!meeting || !meetingReady) return;

    let cancelled = false;
    const assign = (
      element: { meeting: Meeting } | null,
      name: string,
      retries = 0,
    ) => {
      if (cancelled || !element) return;
      try {
        element.meeting = meeting;
      } catch (err) {
        if (retries < 20) {
          window.setTimeout(() => assign(element, name, retries + 1), 50);
        } else {
          console.warn(`${name}: failed to assign meeting`, err);
        }
      }
    };

    window.setTimeout(() => {
      assign(chatElementRef.current, "rtk-chat");
      assign(micToggleRef.current, "rtk-mic-toggle");
    }, 0);

    return () => {
      cancelled = true;
    };
  }, [meeting, meetingReady]);

  const handleChatRef = useCallback((el: HTMLRtkChatElement | null) => {
    chatElementRef.current = el;
  }, []);

  const handleMicRef = useCallback((el: HTMLRtkMicToggleElement | null) => {
    micToggleRef.current = el;
  }, []);

  return (
    <div className="flex h-full flex-col rounded-xl border border-ink-200 bg-white shadow-soft">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-100 px-4 py-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-ink">RealtimeKit chat</h3>
          {meetingReady && <rtk-mic-toggle ref={handleMicRef} size="sm" />}
        </div>
        <span className="text-xs text-ink/70" title={statusError}>
          {status}
        </span>
      </div>

      {(partialTranscript || finalTranscripts.length > 0) && (
        <div className="flex-shrink-0 border-b border-ink-100 bg-sand-50 px-4 py-2 text-xs text-ink-600">
          {finalTranscripts.map((line) => (
            <p key={line.id}>You: {line.text}</p>
          ))}
          {partialTranscript && (
            <p className="italic text-ink-500">
              Listening… {partialTranscript}
            </p>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 bg-sand-50">
        {meetingReady ? (
          <rtk-chat
            ref={handleChatRef}
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-sm text-ink/70">
            {sessionId
              ? status
              : "Send a message to establish a session before realtime chat loads."}
          </div>
        )}
      </div>
    </div>
  );
}

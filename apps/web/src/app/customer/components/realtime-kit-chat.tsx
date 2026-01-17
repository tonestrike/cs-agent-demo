"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RTKClientOptions } from "@cloudflare/realtimekit";
import type { Meeting } from "@cloudflare/realtimekit-ui";
import { apiBaseUrl, demoAuthToken } from "../../../lib/env";
import { logger } from "../../../lib/logger";
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

/**
 * Browser TTS fallback using Web Speech API.
 * Used when server-side voice (WebRTC TTS) is unavailable.
 */
function speakWithBrowserTTS(text: string): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

interface RealtimeKitChatPanelProps {
  sessionId: string | null;
  customer?: Customer | null;
  enableTts?: boolean;
  onDebugEvent?: (
    message: string,
    data?: Record<string, unknown>,
    options?: { level?: "info" | "warn" | "error"; source?: string },
  ) => void;
}

export function RealtimeKitChatPanel({
  sessionId,
  customer,
  enableTts = false,
  onDebugEvent,
}: RealtimeKitChatPanelProps) {
  const [status, setStatus] = useState("Waiting for session...");
  const [, setStatusError] = useState<string | undefined>();
  const [meeting, setMeeting] = useState<RealtimeKitClient | null>(null);
  const [meetingReady, setMeetingReady] = useState(false);
  const [, setPartialTranscript] = useState<string | null>(null);
  const [, setFinalTranscripts] = useState<Array<{ id: string; text: string }>>(
    [],
  );

  // Visual indicator states
  const [, setWsConnected] = useState(false);
  const [, _setIsSpeaking] = useState(false);
  const [, setLastActivity] = useState<{
    type: "send" | "receive" | "status" | "error";
    text: string;
    time: number;
  } | null>(null);

  const meetingRef = useRef<RealtimeKitClient | null>(null);
  const chatElementRef = useRef<HTMLRtkChatElement | null>(null);
  const micToggleRef = useRef<HTMLRtkMicToggleElement | null>(null);
  const sentMessageIds = useRef(new Set<string>());
  const assistantBuffers = useRef(new Map<string, string>());
  const postedAssistantMessageIds = useRef(new Set<string>());
  const pendingAssistantMessages = useRef<
    Array<{ id: string | null; text: string }>
  >([]);
  const ttsEnabled = useRef(enableTts);
  const serverVoiceEnabled = useRef(false); // Tracks if server-side TTS via WebRTC is active
  const meetingReadyRef = useRef(false);
  const timers = useRef<{
    retry?: number;
    chatReady?: number;
    uiReady?: number;
  }>({});
  // Track which session the current meeting was created for to prevent unnecessary recreation
  const meetingSessionRef = useRef<{
    sessionId: string | null;
    customerId: string | null;
  }>({ sessionId: null, customerId: null });
  // Refs for stable logging context
  const sessionIdRef = useRef(sessionId);
  const customerIdRef = useRef(customer?.id ?? null);

  // Stable log function with no dependencies - uses refs for all context
  const log = useCallback(
    (
      message: string,
      data?: Record<string, unknown>,
      level: "info" | "warn" | "error" = "info",
    ) => {
      const payload = {
        component: "rtk-chat",
        sessionId: sessionIdRef.current,
        customerId: customerIdRef.current,
        meetingReady: meetingReadyRef.current,
        ...data,
      };
      onDebugEvent?.(message, payload, { level, source: "rtk" });
      if (level === "error") {
        logger.error(payload, message);
        return;
      }
      if (level === "warn") {
        logger.warn(payload, message);
        return;
      }
      logger.info(payload, message);
    },
    [onDebugEvent],
  );

  // Keep refs in sync with props/state for stable logging
  useEffect(() => {
    ttsEnabled.current = enableTts;
  }, [enableTts]);

  useEffect(() => {
    meetingReadyRef.current = meetingReady;
  }, [meetingReady]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    customerIdRef.current = customer?.id ?? null;
  }, [customer?.id]);

  // Send message to conversation API
  const phoneE164 = customer?.phoneE164;
  const sendToConversation = useCallback(
    async (text: string, source: string) => {
      if (!sessionId || !phoneE164) return;
      setLastActivity({
        type: "send",
        text: `[${source}] ${text.slice(0, 50)}`,
        time: Date.now(),
      });
      try {
        const response = await fetch(
          `${getBaseUrl()}/api/conversations/${sessionId}/message`,
          {
            method: "POST",
            headers: getApiHeaders(),
            body: JSON.stringify({
              phoneNumber: phoneE164,
              text,
              callSessionId: sessionId,
              source,
            }),
          },
        );
        if (!response.ok) {
          const errorText = await response.text();
          log(
            "send.error",
            { status: response.status, error: errorText },
            "error",
          );
          setLastActivity({
            type: "error",
            text: `Error ${response.status}: ${errorText.slice(0, 50)}`,
            time: Date.now(),
          });
        }
      } catch (err) {
        log(
          "send.error",
          { error: err instanceof Error ? err.message : "unknown" },
          "error",
        );
        setLastActivity({
          type: "error",
          text: `Send failed: ${err instanceof Error ? err.message : "unknown"}`,
          time: Date.now(),
        });
      }
    },
    [phoneE164, sessionId, log],
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
      const currentSessionId = meetingSessionRef.current.sessionId;
      if (client) {
        const chatEl = chatElementRef.current;
        const micEl = micToggleRef.current;
        // Keep meeting on elements so RTK disconnect handlers see a valid object.
        if (chatEl && !chatEl.isConnected) {
          chatEl.meeting = client;
        }
        if (micEl && !micEl.isConnected) {
          micEl.meeting = client;
        }
        // Deinit the voice agent before leaving the meeting
        if (currentSessionId) {
          fetch(`${getBaseUrl()}/api/voice-agent/${currentSessionId}/deinit`, {
            method: "POST",
            headers: getApiHeaders(),
          }).catch(() => {});
        }
        client
          .leave()
          .catch(() => {})
          .finally(() => {
            meetingRef.current = null;
            meetingSessionRef.current = { sessionId: null, customerId: null };
          });
      }
      setMeeting(null);
      setMeetingReady(false);
      clearTimers();
    };

    if (!sessionId || !customer?.id) {
      cleanup();
      setStatus("Waiting for conversation session...");
      return;
    }

    // Skip recreation if we already have a meeting for this exact session
    const currentSession = meetingSessionRef.current;
    if (
      meetingRef.current &&
      currentSession.sessionId === sessionId &&
      currentSession.customerId === customer.id
    ) {
      log("meeting.reuse", { sessionId, customerId: customer.id });
      return;
    }

    const loadMeeting = async () => {
      setStatus("Requesting realtime token...");
      log("token.request.start");
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
      log("meeting.join.start", {
        participantId: payload.participantId,
        meetingId: payload.meetingId,
      });
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
      meetingSessionRef.current = { sessionId, customerId: customer.id };
      setMeeting(client);
      setMeetingReady(false);
      setStatus("RealtimeKit chat ready");
      log("meeting.join.success", {
        participantId: payload.participantId,
        meetingId: payload.meetingId,
        preset: payload.presetName ?? undefined,
      });

      // Initialize voice agent for server-side TTS via WebRTC
      try {
        log("voice_agent.init.start", { meetingId: payload.meetingId });
        const voiceAgentResponse = await fetch(
          `${getBaseUrl()}/api/voice-agent/${sessionId}/init`,
          {
            method: "POST",
            headers: getApiHeaders(),
            body: JSON.stringify({
              meetingId: payload.meetingId,
              authToken,
              phoneNumber: customer.phoneE164,
              callSessionId: sessionId,
            }),
          },
        );
        if (!voiceAgentResponse.ok) {
          const errorData = await voiceAgentResponse.json().catch(() => ({}));
          log(
            "voice_agent.init.failed",
            {
              status: voiceAgentResponse.status,
              error: (errorData as { error?: string }).error ?? "unknown",
            },
            "warn",
          );
          serverVoiceEnabled.current = false;
        } else {
          const result = (await voiceAgentResponse.json()) as {
            ok: boolean;
            voiceEnabled?: boolean;
          };
          serverVoiceEnabled.current = result.voiceEnabled ?? false;
          log("voice_agent.init.success", {
            meetingId: payload.meetingId,
            voiceEnabled: serverVoiceEnabled.current,
          });
        }
      } catch (err) {
        log(
          "voice_agent.init.error",
          { error: err instanceof Error ? err.message : "unknown" },
          "warn",
        );
        serverVoiceEnabled.current = false;
      }
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
      log("meeting.error", { error: message });
      scheduleRetry();
    };

    void loadMeeting().catch(handleError);

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [sessionId, customer?.id, customer?.phoneE164, clearTimers, log]);

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
        log("meeting.ready", {
          hasChat: Boolean(chat),
          hasParticipants: Boolean(participants),
        });
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
  }, [meeting, log]);

  // Clear all local state when session changes to avoid stale data from previous sessions
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId triggers full state reset on session change
  useEffect(() => {
    sentMessageIds.current.clear();
    assistantBuffers.current.clear();
    setFinalTranscripts([]);
    setPartialTranscript(null);
    setLastActivity(null);
    setStatusError(undefined);
    postedAssistantMessageIds.current.clear();
    pendingAssistantMessages.current = [];
  }, [sessionId]);

  // Listen for chat messages from the local user
  useEffect(() => {
    if (!meeting || !meetingReady) return;

    let cancelled = false;
    const handleChatUpdate = (event: ChatEvent) => {
      const detail = "detail" in event ? event.detail : event;
      const msg = detail && "message" in detail ? detail.message : undefined;

      // Log all chat events for debugging
      log("chat.event", {
        hasMsg: Boolean(msg),
        msgId: msg?.id,
        msgType: msg?.type,
        msgUserId: msg?.userId,
        selfUserId: meeting.self?.userId,
        textPreview: msg?.message?.slice(0, 30),
      });

      // Accept both "chat" and "text" message types from RTK
      if (!msg?.id || (msg.type !== "chat" && msg.type !== "text")) {
        log("chat.skip.nonchat", { type: msg?.type });
        return;
      }
      if (msg.userId !== meeting.self?.userId) {
        log("chat.skip.remote", { userId: msg.userId });
        return;
      }
      if (sentMessageIds.current.has(msg.id)) {
        log("chat.skip.duplicate", { msgId: msg.id });
        return;
      }

      const text = msg.message?.trim();
      if (!text) {
        log("chat.skip.empty");
        return;
      }

      log("chat.forward", { textPreview: text.slice(0, 50) });
      sentMessageIds.current.add(msg.id);
      void sendToConversation(text, "rtk_chat");
    };

    const attach = () => {
      if (cancelled) return;
      const { chat } = meeting;
      if (!chat || !isEmitterReady(chat)) {
        log("chat.attach.waiting");
        timers.current.chatReady = window.setTimeout(attach, 100);
        return;
      }
      try {
        chat.addListener("chatUpdate", handleChatUpdate);
        log("chat.attach.success", { selfUserId: meeting.self?.userId });
      } catch (err) {
        log(
          "chat.attach.retry",
          { error: err instanceof Error ? err.message : "unknown" },
          "warn",
        );
        timers.current.chatReady = window.setTimeout(attach, 100);
      }
    };
    log("chat.attach.start", {
      meetingReady,
      hasMeeting: Boolean(meeting),
    });
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
  }, [meeting, meetingReady, sendToConversation, log]);

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
        log("transcript.partial", { textPreview: text.slice(0, 60) });
      } else {
        setPartialTranscript(null);
        setFinalTranscripts((prev) =>
          [...prev, { id: crypto.randomUUID(), text }].slice(-4),
        );
        log("transcript.final", {
          textPreview: text.slice(0, 120),
          userId: event.userId ?? null,
        });
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
  }, [meeting, meetingReady, sendToConversation, log]);

  const appendAssistantChatMessage = useCallback(
    (messageId: string | null | undefined, text: string | undefined) => {
      const chat = meetingRef.current?.chat as
        | (RealtimeKitChat & {
            messages?: ChatMessage[];
            emit?: (event: string, payload: unknown) => void;
          })
        | undefined;
      const trimmed = text?.trim();
      if (!trimmed) return;
      if (!chat || !isEmitterReady(chat)) {
        pendingAssistantMessages.current.push({
          id: messageId ?? null,
          text: trimmed,
        });
        log("assistant.chat.buffer", {
          reason: "chat_unavailable",
          pending: pendingAssistantMessages.current.length,
        });
        return;
      }
      const id = messageId ? `assistant-${messageId}` : crypto.randomUUID();
      if (postedAssistantMessageIds.current.has(id)) {
        log("assistant.chat.skip", { reason: "duplicate", id });
        return;
      }
      const now = Date.now();
      const message: ChatMessage & {
        displayName?: string;
        time?: Date;
        timeMs?: number;
      } = {
        id,
        type: "text",
        userId: "assistant",
        displayName: "Bot",
        message: trimmed,
        time: new Date(now),
        timeMs: now,
      };
      const messages = Array.isArray(chat.messages)
        ? [...chat.messages, message]
        : [message];
      (chat as { messages: ChatMessage[] }).messages = messages;
      postedAssistantMessageIds.current.add(id);
      try {
        chat.emit?.("chatUpdate", {
          action: "add",
          message,
          messages,
        });
        log("assistant.chat.added", {
          id,
          preview: trimmed.slice(0, 60),
        });
      } catch (err) {
        log(
          "assistant.chat.error",
          { error: err instanceof Error ? err.message : "unknown" },
          "warn",
        );
      }
    },
    [log],
  );

  // Flush buffered assistant/status messages once chat is ready
  useEffect(() => {
    if (!meetingReady || pendingAssistantMessages.current.length === 0) return;
    const queued = [...pendingAssistantMessages.current];
    pendingAssistantMessages.current = [];
    for (const item of queued) {
      appendAssistantChatMessage(item.id, item.text);
    }
  }, [appendAssistantChatMessage, meetingReady]);

  // WebSocket for TTS playback of assistant responses
  useEffect(() => {
    if (!sessionId || !customer?.id) {
      setWsConnected(false);
      return;
    }

    const url = new URL(getBaseUrl());
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/api/conversations/${sessionId}/socket`;
    // Pass callSessionId so DO can detect new calls and reset greeting
    url.searchParams.set("callSessionId", sessionId);
    if (demoAuthToken) url.searchParams.set("token", demoAuthToken);

    const socket = new WebSocket(url.toString());

    socket.onopen = () => {
      setWsConnected(true);
      setLastActivity({
        type: "receive",
        text: "WebSocket connected",
        time: Date.now(),
      });
      log("rtk.tts.ws.open", { sessionId });
    };

    socket.onclose = (event) => {
      setWsConnected(false);
      setLastActivity({
        type: "error",
        text: "WebSocket disconnected",
        time: Date.now(),
      });
      log(
        "rtk.tts.ws.close",
        {
          code: event.code,
          reason: event.reason || undefined,
          wasClean: event.wasClean,
        },
        "warn",
      );
    };

    socket.onerror = () => {
      setLastActivity({
        type: "error",
        text: "WebSocket error",
        time: Date.now(),
      });
      log("rtk.tts.ws.error", { sessionId }, "error");
    };

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
          setLastActivity({
            type: "status",
            text: `Status: ${text?.slice(0, 40) ?? ""}`,
            time: Date.now(),
          });
          log("rtk.tts.status", {
            textPreview: text?.slice(0, 80) ?? "",
            messageId: payload.messageId ?? null,
          });
          if (text) {
            appendAssistantChatMessage(payload.messageId, text);
            // Fallback to browser TTS if server voice is disabled
            if (ttsEnabled.current && !serverVoiceEnabled.current) {
              speakWithBrowserTTS(text);
            }
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
          // Show streaming indicator
          const buffer = assistantBuffers.current.get(messageId) ?? "";
          if (buffer.length % 20 === 0) {
            // Update every ~20 chars to reduce overhead
            setLastActivity({
              type: "receive",
              text: `Streaming: ${buffer.slice(-30)}...`,
              time: Date.now(),
            });
          }
        } else if (payload.type === "final") {
          const buffer = assistantBuffers.current.get(messageId) ?? "";
          assistantBuffers.current.delete(messageId);
          const text = payload.data?.replyText ?? buffer;
          setLastActivity({
            type: "receive",
            text: `Reply: ${text.slice(0, 40)}...`,
            time: Date.now(),
          });
          log("rtk.tts.final", {
            textLength: text.length,
            messageId,
          });
          appendAssistantChatMessage(messageId, text);
          // Fallback to browser TTS if server voice is disabled
          if (ttsEnabled.current && !serverVoiceEnabled.current) {
            speakWithBrowserTTS(text);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    return () => {
      socket.close();
      setWsConnected(false);
    };
  }, [sessionId, customer?.id, appendAssistantChatMessage, log]);

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
          log(
            "meeting.assign.failed",
            {
              target: name,
              error: err instanceof Error ? err.message : "unknown",
            },
            "warn",
          );
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
  }, [meeting, meetingReady, log]);

  const handleChatRef = useCallback((el: HTMLRtkChatElement | null) => {
    chatElementRef.current = el;
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-ink-200 bg-gradient-to-br from-sand-50 via-white to-sand-100 p-3 shadow-soft">
      <div className="relative h-full overflow-hidden rounded-xl border border-ink-100 bg-white/75 shadow-inner backdrop-blur">
        {/* Always render rtk-chat to prevent unmounting and focus loss */}
        {/* Key forces remount on session change to clear stale messages */}
        {meeting && (
          <rtk-chat
            key={sessionId}
            ref={handleChatRef}
            style={{
              width: "100%",
              height: "100%",
              opacity: meetingReady ? 1 : 0.05,
              pointerEvents: meetingReady ? "auto" : "none",
            }}
          />
        )}
        {/* Overlay loading state when not ready */}
        {!meetingReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80 px-4 text-sm text-ink/80 backdrop-blur">
            <div className="rounded-full bg-ink-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm">
              Preparing chat
            </div>
            <p className="text-center text-xs text-ink-600">
              {sessionId
                ? status
                : "Send a message to establish a session before realtime chat loads."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

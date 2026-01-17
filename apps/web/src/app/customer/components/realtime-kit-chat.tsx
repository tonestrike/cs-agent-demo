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

  // Visual indicator states
  const [wsConnected, setWsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastActivity, setLastActivity] = useState<{
    type: "send" | "receive" | "status" | "error";
    text: string;
    time: number;
  } | null>(null);

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
              phoneNumber: customer.phoneE164,
              text,
              callSessionId: sessionId,
              source,
            }),
          },
        );
        if (!response.ok) {
          const errorText = await response.text();
          console.error("rtk message send failed", response.status, errorText);
          setLastActivity({
            type: "error",
            text: `Error ${response.status}: ${errorText.slice(0, 50)}`,
            time: Date.now(),
          });
        }
      } catch (err) {
        console.error("rtk message send failed", err);
        setLastActivity({
          type: "error",
          text: `Send failed: ${err instanceof Error ? err.message : "unknown"}`,
          time: Date.now(),
        });
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

  // Clear all local state when session changes to avoid stale data from previous sessions
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId triggers full state reset on session change
  useEffect(() => {
    sentMessageIds.current.clear();
    assistantBuffers.current.clear();
    setFinalTranscripts([]);
    setPartialTranscript(null);
    setLastActivity(null);
    setStatusError(undefined);
  }, [sessionId]);

  // Listen for chat messages from the local user
  useEffect(() => {
    if (!meeting || !meetingReady) return;

    let cancelled = false;
    const handleChatUpdate = (event: ChatEvent) => {
      const detail = "detail" in event ? event.detail : event;
      const msg = detail && "message" in detail ? detail.message : undefined;

      // Log all chat events for debugging
      console.log("[RTK Chat] chatUpdate event:", {
        hasMsg: Boolean(msg),
        msgId: msg?.id,
        msgType: msg?.type,
        msgUserId: msg?.userId,
        selfUserId: meeting.self?.userId,
        text: msg?.message?.slice(0, 30),
      });

      // Accept both "chat" and "text" message types from RTK
      if (!msg?.id || (msg.type !== "chat" && msg.type !== "text")) {
        console.log(
          "[RTK Chat] Skipping: not a chat message, type:",
          msg?.type,
        );
        return;
      }
      if (msg.userId !== meeting.self?.userId) {
        console.log("[RTK Chat] Skipping: not from local user");
        return;
      }
      if (sentMessageIds.current.has(msg.id)) {
        console.log("[RTK Chat] Skipping: duplicate message ID");
        return;
      }

      const text = msg.message?.trim();
      if (!text) {
        console.log("[RTK Chat] Skipping: empty message");
        return;
      }

      console.log("[RTK Chat] Sending to conversation:", text.slice(0, 50));
      sentMessageIds.current.add(msg.id);
      void sendToConversation(text, "rtk_chat");
    };

    const attach = () => {
      if (cancelled) return;
      const { chat } = meeting;
      if (!chat || !isEmitterReady(chat)) {
        console.log("[RTK Chat] Waiting for chat emitter to be ready...");
        timers.current.chatReady = window.setTimeout(attach, 100);
        return;
      }
      try {
        chat.addListener("chatUpdate", handleChatUpdate);
        console.log("[RTK Chat] Successfully attached chat listener", {
          selfUserId: meeting.self?.userId,
        });
      } catch (err) {
        console.warn("[RTK Chat] Failed to attach listener, retrying...", err);
        timers.current.chatReady = window.setTimeout(attach, 100);
      }
    };
    console.log("[RTK Chat] Effect running, attempting to attach listener", {
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
    if (!sessionId || !customer) {
      setWsConnected(false);
      return;
    }

    const url = new URL(getBaseUrl());
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/api/conversations/${sessionId}/socket`;
    if (demoAuthToken) url.searchParams.set("token", demoAuthToken);

    const socket = new WebSocket(url.toString());

    socket.onopen = () => {
      setWsConnected(true);
      setLastActivity({
        type: "receive",
        text: "WebSocket connected",
        time: Date.now(),
      });
    };

    socket.onclose = () => {
      setWsConnected(false);
      setLastActivity({
        type: "error",
        text: "WebSocket disconnected",
        time: Date.now(),
      });
    };

    socket.onerror = () => {
      setLastActivity({
        type: "error",
        text: "WebSocket error",
        time: Date.now(),
      });
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
          if (text && ttsEnabled.current) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.onstart = () => setIsSpeaking(true);
            utterance.onend = () => setIsSpeaking(false);
            utterance.onerror = () => setIsSpeaking(false);
            window.speechSynthesis.speak(utterance);
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
          if (text && ttsEnabled.current) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.onstart = () => setIsSpeaking(true);
            utterance.onend = () => setIsSpeaking(false);
            utterance.onerror = () => setIsSpeaking(false);
            window.speechSynthesis.speak(utterance);
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

  // Get activity indicator color based on type
  const getActivityColor = (
    type: typeof lastActivity extends { type: infer T } | null ? T : never,
  ) => {
    switch (type) {
      case "send":
        return "bg-blue-500";
      case "receive":
        return "bg-green-500";
      case "status":
        return "bg-yellow-500";
      case "error":
        return "bg-red-500";
      default:
        return "bg-gray-400";
    }
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-ink-200 bg-white shadow-soft">
      {/* Header with status indicators */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-100 px-4 py-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-ink">RealtimeKit chat</h3>
          {meetingReady && <rtk-mic-toggle ref={handleMicRef} size="sm" />}
        </div>
        <div className="flex items-center gap-2">
          {/* WebSocket connection indicator */}
          <div
            className="flex items-center gap-1"
            title={
              wsConnected ? "WebSocket connected" : "WebSocket disconnected"
            }
          >
            <div
              className={`h-2 w-2 rounded-full ${wsConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`}
            />
            <span className="text-xs text-ink/50">WS</span>
          </div>
          {/* RTK meeting indicator */}
          <div
            className="flex items-center gap-1"
            title={meetingReady ? "Meeting ready" : "Meeting not ready"}
          >
            <div
              className={`h-2 w-2 rounded-full ${meetingReady ? "bg-green-500" : meeting ? "bg-yellow-500 animate-pulse" : "bg-gray-400"}`}
            />
            <span className="text-xs text-ink/50">RTK</span>
          </div>
          {/* TTS speaking indicator */}
          {isSpeaking && (
            <div className="flex items-center gap-1" title="TTS speaking">
              <div className="h-2 w-2 rounded-full bg-purple-500 animate-pulse" />
              <span className="text-xs text-ink/50">TTS</span>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-100 bg-ink-50 px-4 py-1.5">
        <span className="text-xs text-ink/70" title={statusError}>
          {status}
        </span>
        {/* Last activity indicator */}
        {lastActivity && (
          <div className="flex items-center gap-1.5 text-xs text-ink/60">
            <div
              className={`h-1.5 w-1.5 rounded-full ${getActivityColor(lastActivity.type)}`}
            />
            <span className="max-w-48 truncate" title={lastActivity.text}>
              {lastActivity.text}
            </span>
            <span className="text-ink/40">
              {Math.round((Date.now() - lastActivity.time) / 1000)}s ago
            </span>
          </div>
        )}
      </div>

      {/* Transcript display */}
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

      {/* Main chat area */}
      <div className="relative min-h-0 flex-1 bg-sand-50">
        {/* Always render rtk-chat to prevent unmounting and focus loss */}
        {/* Key forces remount on session/participant change to clear stale messages */}
        {meeting && (
          <rtk-chat
            key={`${sessionId}-${meeting.self?.userId ?? "unknown"}`}
            ref={handleChatRef}
            style={{
              width: "100%",
              height: "100%",
              opacity: meetingReady ? 1 : 0,
              pointerEvents: meetingReady ? "auto" : "none",
            }}
          />
        )}
        {/* Overlay loading state when not ready */}
        {!meetingReady && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-sm text-ink/70 bg-sand-50">
            {sessionId
              ? status
              : "Send a message to establish a session before realtime chat loads."}
          </div>
        )}
      </div>
    </div>
  );
}

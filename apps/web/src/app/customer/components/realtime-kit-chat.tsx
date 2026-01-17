"use client";

import { useEffect, useRef, useState } from "react";

import { apiBaseUrl, demoAuthToken } from "../../../lib/env";
import type { Customer } from "../types";

type RealtimeKitClient = {
  join: () => Promise<void>;
  leave: () => Promise<void>;
};

declare global {
  interface Window {
    RealtimeKit?: {
      init?: (options: {
        authToken: string;
        defaults?: { audio?: boolean; video?: boolean };
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
}

export function RealtimeKitChatPanel({
  sessionId,
  customer,
}: RealtimeKitChatPanelProps) {
  const [status, setStatus] = useState<PreloadState>({
    status: "Waiting for session...",
  });
  const [meeting, setMeeting] = useState<RealtimeKitClient | null>(null);
  const meetingRef = useRef<RealtimeKitClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cleanup = () => {
      const client = meetingRef.current;
      if (client) {
        client.leave().catch(() => {});
        meetingRef.current = null;
      }
      setMeeting(null);
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
      });
      await client.join();
      if (cancelled) {
        await client.leave();
        return;
      }
      meetingRef.current = client;
      setMeeting(client);
      setStatus({ status: "RealtimeKit chat ready" });
    };

    loadRealtimeKit().catch((error) => {
      if (cancelled) {
        return;
      }
      const message =
        error instanceof Error ? error.message : "RealtimeKit failed to load.";
      setStatus({ status: "RealtimeKit unavailable", error: message });
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [sessionId, customer]);

  return (
    <div className="rounded-xl border border-ink-200 bg-white shadow-soft">
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">RealtimeKit chat</h3>
        <span className="text-xs text-ink/70" title={status.error ?? undefined}>
          {status.status}
        </span>
      </div>
      <div className="h-[360px] bg-sand-50">
        {meeting ? (
          <div className="h-full">
            <rtk-chat
              meeting={meeting}
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

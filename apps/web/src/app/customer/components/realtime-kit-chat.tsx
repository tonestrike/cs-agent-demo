"use client";

import { useEffect, useRef, useState } from "react";

import type { Customer } from "../types";
import { realtimeKitApiKey, realtimeKitRegion } from "../../../lib/env";

type RealtimeKitMeeting = {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  join: () => Promise<void>;
  leave: () => Promise<void>;
};

declare global {
  interface Window {
    RealtimeKit?: {
      Meeting?: new (options: {
        roomName: string;
        participantName: string;
        apiKey?: string;
        region?: string;
      }) => RealtimeKitMeeting;
      init?: (options: {
        authToken: string;
        defaults?: { audio?: boolean; video?: boolean };
      }) => Promise<unknown>;
    };
  }
}

interface RealtimeKitChatPanelProps {
  sessionId: string | null;
  customer?: Customer | null;
}

export function RealtimeKitChatPanel({
  sessionId,
  customer,
}: RealtimeKitChatPanelProps) {
  const [meeting, setMeeting] = useState<RealtimeKitMeeting | null>(null);
  const [status, setStatus] = useState("Waiting for session...");
  const meetingRef = useRef<RealtimeKitMeeting | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cleanup = () => {
      meetingRef.current?.leave().catch(() => {});
      meetingRef.current = null;
      setMeeting(null);
    };

    if (!sessionId) {
      cleanup();
      setStatus("Waiting for conversation session...");
      return;
    }

    const loadMeeting = async () => {
      if (!window.RealtimeKit?.Meeting) {
        setStatus("RealtimeKit loader not ready.");
        return;
      }
      const options: {
        roomName: string;
        participantName: string;
        apiKey?: string;
        region?: string;
      } = {
        roomName: sessionId,
        participantName: customer?.displayName ?? "Customer",
      };
      if (realtimeKitApiKey) {
        options.apiKey = realtimeKitApiKey;
      }
      if (realtimeKitRegion) {
        options.region = realtimeKitRegion;
      }

      setStatus("Connecting to RealtimeKit...");
      const instance = new window.RealtimeKit.Meeting(options);
      meetingRef.current = instance;

      instance.on("connected", () => {
        if (cancelled) {
          return;
        }
        setStatus("RealtimeKit chat ready");
      });
      instance.on("disconnected", () => {
        if (!cancelled) {
          setStatus("RealtimeKit disconnected");
        }
      });
      instance.on("error", () => {
        if (!cancelled) {
          setStatus("RealtimeKit error");
        }
      });

      try {
        await instance.join();
        if (cancelled) {
          await instance.leave();
          return;
        }
        setMeeting(instance);
      } catch {
        if (!cancelled) {
          setStatus("Failed to join RealtimeKit chat");
        }
      }
    };

    loadMeeting();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [sessionId, customer]);

  return (
    <div className="rounded-xl border border-ink-200 bg-white shadow-soft">
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">
          RealtimeKit chat preview
        </h3>
        <span className="text-xs text-ink/70">{status}</span>
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
              ? status
              : "Send a message to establish a session before RealtimeKit loads."}
          </div>
        )}
      </div>
    </div>
  );
}

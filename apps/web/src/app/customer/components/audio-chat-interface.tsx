"use client";

import { useCallback, useEffect, useState } from "react";
// Note: RealtimeKit SDK is loaded dynamically, not via import
// import { useRealtimeKit } from "@cloudflare/realtimekit";
import { Customer } from "@pestcall/core/customers/types";

interface AudioChatInterfaceProps {
  customer: Customer | null;
  phoneNumber: string;
  callSessionId: string | null;
  onAudioStatusChange?: (status: string) => void;
}

type AudioStatus = "disconnected" | "connecting" | "connected" | "error";

export function AudioChatInterface({
  customer,
  phoneNumber,
  callSessionId,
  onAudioStatusChange,
}: AudioChatInterfaceProps) {
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("disconnected");
  const [isSdkReady, setIsSdkReady] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Check if RealtimeKit SDK is loaded
  useEffect(() => {
    const checkSdk = () => {
      if (typeof window !== "undefined" && (window as any).RealtimeKit) {
        setIsSdkReady(true);
      } else {
        setTimeout(checkSdk, 100);
      }
    };
    checkSdk();
  }, []);

  const handleStatusChange = useCallback(
    (status: AudioStatus) => {
      setAudioStatus(status);
      onAudioStatusChange?.(status);
    },
    [onAudioStatusChange],
  );

  const startAudioChat = useCallback(async () => {
    if (!isSdkReady) {
      handleStatusChange("error");
      return;
    }

    handleStatusChange("connecting");

    try {
      // Initialize RealtimeKit meeting
      const meeting = new (window as any).RealtimeKit.Meeting({
        roomName: callSessionId || `customer-${phoneNumber}-${Date.now()}`,
        participantName: customer?.name || "Customer",
        apiKey: process.env.NEXT_PUBLIC_REALTIMEKIT_API_KEY,
        region: process.env.NEXT_PUBLIC_REALTIMEKIT_REGION || "us-east-1",
      });

      // Set up event listeners
      meeting.on("connected", () => {
        handleStatusChange("connected");
      });

      meeting.on("disconnected", () => {
        handleStatusChange("disconnected");
      });

      meeting.on("error", (error: any) => {
        console.error("RealtimeKit error:", error);
        handleStatusChange("error");
      });

      // Join the meeting
      await meeting.join();

      // Store meeting instance for cleanup
      (window as any).__realtimekit_meeting = meeting;
    } catch (error) {
      console.error("Failed to start audio chat:", error);
      handleStatusChange("error");
    }
  }, [isSdkReady, callSessionId, phoneNumber, customer?.name, handleStatusChange]);

  const toggleMute = useCallback(() => {
    const meeting = (window as any).__realtimekit_meeting;
    if (meeting) {
      if (isMuted) {
        meeting.unmute();
        setIsMuted(false);
      } else {
        meeting.mute();
        setIsMuted(true);
      }
    }
  }, [isMuted]);

  const hangUp = useCallback(() => {
    const meeting = (window as any).__realtimekit_meeting;
    if (meeting) {
      meeting.leave();
      handleStatusChange("disconnected");
    }
  }, [handleStatusChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const meeting = (window as any).__realtimekit_meeting;
      if (meeting) {
        meeting.leave();
      }
    };
  }, []);

  const getStatusColor = () => {
    switch (audioStatus) {
      case "connected":
        return "text-green-600";
      case "connecting":
        return "text-yellow-600";
      case "error":
        return "text-red-600";
      default:
        return "text-gray-500";
    }
  };

  const getStatusText = () => {
    switch (audioStatus) {
      case "connected":
        return "Connected";
      case "connecting":
        return "Connecting...";
      case "error":
        return "Connection Error";
      default:
        return "Disconnected";
    }
  };

  if (!isSdkReady) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading audio interface...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-[400px] bg-white rounded-lg border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full ${getStatusColor()}`}></div>
          <span className="font-medium text-gray-900">Audio Chat</span>
          <span className="text-sm text-gray-600">{getStatusText()}</span>
        </div>
        {customer && (
          <div className="text-sm text-gray-600">
            {customer.name} • {phoneNumber}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        {audioStatus === "disconnected" && (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
              <svg
                className="w-8 h-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900">
              Start Audio Chat
            </h3>
            <p className="text-gray-600 max-w-md">
              Connect with an agent using voice chat. Make sure your microphone
              is enabled.
            </p>
            <button
              onClick={startAudioChat}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <svg
                className="-ml-1 mr-2 h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1.586a1 1 0 01.707.293l.707.707A1 1 0 0012.414 11H13m-3-3v6m0 0v6m0-6h6"
                />
              </svg>
              Start Audio Chat
            </button>
          </div>
        )}

        {audioStatus === "connecting" && (
          <div className="text-center space-y-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <h3 className="text-lg font-medium text-gray-900">
              Connecting...
            </h3>
            <p className="text-gray-600">
              Establishing audio connection with the agent.
            </p>
          </div>
        )}

        {audioStatus === "connected" && (
          <div className="text-center space-y-6 w-full max-w-md">
            <div className="space-y-4">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg
                  className="w-10 h-10 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-medium text-gray-900">
                Connected to Agent
              </h3>
              <p className="text-gray-600">
                You can now speak with the agent. Use the controls below.
              </p>
            </div>

            {/* Audio Controls */}
            <div className="flex justify-center space-x-4">
              <button
                onClick={toggleMute}
                className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                  isMuted
                    ? "text-white bg-red-600 hover:bg-red-700 focus:ring-red-500"
                    : "text-gray-700 bg-gray-200 hover:bg-gray-300 focus:ring-gray-500"
                }`}
              >
                {isMuted ? (
                  <>
                    <svg
                      className="-ml-1 mr-2 h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                      />
                    </svg>
                    Unmute
                  </>
                ) : (
                  <>
                    <svg
                      className="-ml-1 mr-2 h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                      />
                    </svg>
                    Mute
                  </>
                )}
              </button>

              <button
                onClick={hangUp}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                <svg
                  className="-ml-1 mr-2 h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.684A1 1 0 008.28 3H5z"
                  />
                </svg>
                Hang Up
              </button>
            </div>
          </div>
        )}

        {audioStatus === "error" && (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <svg
                className="w-8 h-8 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900">
              Connection Error
            </h3>
            <p className="text-gray-600 max-w-md">
              Unable to establish audio connection. Please check your internet
              connection and try again.
            </p>
            <button
              onClick={startAudioChat}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
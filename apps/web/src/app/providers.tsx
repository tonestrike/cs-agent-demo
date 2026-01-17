"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

const preloadRealtimeKit = async () => {
  try {
    const loader = await import("@cloudflare/realtimekit-ui/loader");
    loader.defineCustomElements?.(window);
  } catch (error) {
    console.error("Failed to load RealtimeKit UI loader", error);
  }
  try {
    const core = await import("@cloudflare/realtimekit");
    if (!window.RealtimeKit) {
      window.RealtimeKit = core.default ?? core;
    }
  } catch (error) {
    console.error("Failed to initialize RealtimeKit core", error);
  }
};

const RealtimeKitLoader = () => {
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (cancelled) return;
      await preloadRealtimeKit();
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
};

export const Providers = ({ children }: { children: React.ReactNode }) => {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 5_000,
            gcTime: 5 * 60_000,
          },
        },
      }),
  );

  return (
    <>
      <RealtimeKitLoader />
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </>
  );
};

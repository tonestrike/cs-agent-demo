"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Badge, Card } from "../../../../components/ui";
import { callRpc } from "../../../../lib/api";

type CallSession = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  phoneE164: string;
  customerCacheId: string | null;
  status: string;
  transport: string;
  summary: string | null;
};

type CallTurn = {
  id: string;
  callSessionId: string;
  ts: string;
  speaker: string;
  text: string;
  meta: {
    tools?: unknown[];
    modelCalls?: unknown[];
    [key: string]: unknown;
  };
};

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const maskPhone = (phoneE164: string) => {
  const last4 = phoneE164.slice(-4);
  return `***-${last4}`;
};

export default function CallDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const callQuery = useQuery({
    queryKey: ["call-detail", params.id],
    queryFn: () =>
      callRpc<{ session: CallSession; turns: CallTurn[] }>("calls/get", {
        callSessionId: params.id,
      }),
  });

  return (
    <main className="grid-dots min-h-screen px-6 py-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Link href="/agent" className="text-xs uppercase text-ink/60">
          ← Back to dashboard
        </Link>
        <Card className="flex flex-col gap-3">
          <Badge className="w-fit">Call Detail</Badge>
          {callQuery.data?.session ? (
            <>
              <h1 className="text-2xl font-semibold text-ink">
                {maskPhone(callQuery.data.session.phoneE164)}
              </h1>
              <p className="text-sm text-ink/60">
                {formatDateTime(callQuery.data.session.startedAt)} •{" "}
                {callQuery.data.session.status}
              </p>
            </>
          ) : (
            <p className="text-sm text-ink/60">Loading session...</p>
          )}
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">Transcript</h2>
          <div className="space-y-3">
            {(callQuery.data?.turns ?? []).map((turn) => (
              <div
                key={turn.id}
                className="rounded-2xl border border-ink/10 bg-white/80 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs uppercase tracking-wide text-ink/60">
                    {turn.speaker} • {formatDateTime(turn.ts)}
                  </span>
                  <span className="text-xs text-ink/50">
                    {turn.meta.tools?.length ?? 0} tools •{" "}
                    {turn.meta.modelCalls?.length ?? 0} model calls
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink">{turn.text}</p>
              </div>
            ))}
            {callQuery.isLoading && (
              <p className="text-sm text-ink/60">Loading transcript...</p>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}

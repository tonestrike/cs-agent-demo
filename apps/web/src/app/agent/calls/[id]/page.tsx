"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Badge, Card } from "../../../../components/ui";
import { rpcClient } from "../../../../lib/orpc";

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
      rpcClient.calls.get({
        callSessionId: params.id,
      }),
  });

  return (
    <main className="grid-dots min-h-screen px-6 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <Link href="/agent" className="text-xs uppercase text-ink/60">
          ← Back to dashboard
        </Link>
        <Card className="flex flex-col gap-3 animate-rise">
          <Badge className="w-fit">Call Detail</Badge>
          {callQuery.data?.session ? (
            <>
              <h1 className="text-2xl font-semibold text-ink">
                {maskPhone(callQuery.data.session.phoneE164)}{" "}
                <span className="text-sm font-semibold uppercase tracking-wide text-ink/50">
                  {callQuery.data.session.transport}
                </span>
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

        <Card className="flex flex-col gap-4 animate-rise">
          <h2 className="text-lg font-semibold text-ink">Transcript</h2>
          <div className="scroll-area max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {(callQuery.data?.turns ?? []).map((turn) => {
              const meta = turn.meta as {
                tools?: unknown[];
                modelCalls?: unknown[];
              };
              return (
                <div
                  key={turn.id}
                  className="rounded-2xl border border-ink/10 bg-white/80 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs uppercase tracking-wide text-ink/60">
                      {turn.speaker} • {formatDateTime(turn.ts)}
                    </span>
                    <span className="text-xs text-ink/50">
                      {meta.tools?.length ?? 0} tools •{" "}
                      {meta.modelCalls?.length ?? 0} model calls
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-ink">{turn.text}</p>
                  {meta.tools ? (
                    <div className="mt-3 rounded-2xl border border-ink/10 bg-sand/60 p-3 text-xs text-ink/70">
                      <p className="font-semibold uppercase tracking-wide text-ink/60">
                        Tool Calls
                      </p>
                      <pre className="mt-2 whitespace-pre-wrap">
                        {JSON.stringify(meta.tools, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                  {meta.modelCalls ? (
                    <div className="mt-3 rounded-2xl border border-ink/10 bg-white/80 p-3 text-xs text-ink/70">
                      <p className="font-semibold uppercase tracking-wide text-ink/60">
                        Model Calls
                      </p>
                      <pre className="mt-2 whitespace-pre-wrap">
                        {JSON.stringify(meta.modelCalls, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {callQuery.isLoading && (
              <p className="text-sm text-ink/60">Loading transcript...</p>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}

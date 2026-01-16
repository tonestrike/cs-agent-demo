import Link from "next/link";

import { Badge, Button, Card } from "../components/ui";

export default function HomePage() {
  return (
    <main className="grid-dots min-h-screen px-6 py-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12">
        <header className="flex flex-col gap-6">
          <Badge className="w-fit">PestCall Demo</Badge>
          <h1 className="text-4xl font-semibold leading-tight text-ink sm:text-5xl">
            A premium support console for{" "}
            <span className="accent-text">pest control</span>.
          </h1>
          <p className="max-w-2xl text-lg text-ink/70">
            Run a live customer conversation while the internal team tracks
            calls, tickets, and model traces in real time.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/customer">
              <Button>Customer Portal</Button>
            </Link>
            <Link href="/agent">
              <Button className="bg-moss hover:bg-ink">Agent Dashboard</Button>
            </Link>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <Link href="/customer" className="group">
            <Card className="animate-rise transition hover:-translate-y-1 hover:shadow-[0_26px_60px_rgba(12,27,31,0.2)]">
              <h2 className="text-2xl font-semibold">Customer Portal</h2>
              <p className="mt-3 text-ink/70">
                Simulate a caller: send messages, confirm ZIP codes, and see how
                the agent responds while preserving context.
              </p>
              <span className="mt-6 inline-flex text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                Open portal →
              </span>
            </Card>
          </Link>
          <Link href="/agent" className="group">
            <Card className="animate-rise transition hover:-translate-y-1 hover:shadow-[0_26px_60px_rgba(12,27,31,0.2)]">
              <h2 className="text-2xl font-semibold">Agent Dashboard</h2>
              <p className="mt-3 text-ink/70">
                Review call sessions, ticket status, tool calls, and model usage
                from a single view.
              </p>
              <span className="mt-6 inline-flex text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
                Open dashboard →
              </span>
            </Card>
          </Link>
        </div>
      </div>
    </main>
  );
}

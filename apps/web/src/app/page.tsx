import Link from "next/link";

import { Badge, Button, Card } from "../components/ui";

export default function HomePage() {
  return (
    <main className="grid-dots min-h-screen px-6 py-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header className="flex flex-col gap-6">
          <Badge className="w-fit">PestCall Demo</Badge>
          <h1 className="text-4xl font-semibold leading-tight text-ink sm:text-5xl">
            Run a live customer conversation and monitor every step.
          </h1>
          <p className="max-w-2xl text-lg text-ink/70">
            This demo console lets you act as a customer while the internal team
            monitors calls, tickets, and model traces in real time.
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
          <Card>
            <h2 className="text-2xl font-semibold">Customer Portal</h2>
            <p className="mt-3 text-ink/70">
              Simulate a caller: send messages, confirm ZIP codes, and see how
              the agent responds while preserving context.
            </p>
          </Card>
          <Card>
            <h2 className="text-2xl font-semibold">Agent Dashboard</h2>
            <p className="mt-3 text-ink/70">
              Review call sessions, ticket status, tool calls, and model usage
              from a single view.
            </p>
          </Card>
        </div>
      </div>
    </main>
  );
}

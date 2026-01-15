import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import Link from "next/link";

import "./globals.css";
import { Providers } from "./providers";

const displayFont = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "PestCall Demo",
  description: "Customer and agent demo console for PestCall.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${displayFont.variable} ${bodyFont.variable} min-h-screen`}
      >
        <Providers>
          <div className="flex min-h-screen flex-col">
            <header className="sticky top-0 z-50 border-b border-ink/10 bg-white/80 backdrop-blur">
              <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
                <Link href="/" className="text-lg font-semibold text-ink">
                  <span className="accent-text font-display text-xl">
                    PestCall
                  </span>
                </Link>
                <nav className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink/70">
                  <Link
                    href="/customer"
                    className="rounded-full border border-ink/10 bg-white/70 px-4 py-2 transition hover:border-ink/30 hover:text-ink"
                  >
                    Customer
                  </Link>
                  <Link
                    href="/agent"
                    className="rounded-full border border-ink/10 bg-white/70 px-4 py-2 transition hover:border-ink/30 hover:text-ink"
                  >
                    Agent
                  </Link>
                </nav>
              </div>
            </header>
            <div className="flex-1">{children}</div>
          </div>
        </Providers>
      </body>
    </html>
  );
}

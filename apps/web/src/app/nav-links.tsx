"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [
  { href: "/customer", label: "Customer" },
  { href: "/agent", label: "Agent" },
  { href: "/agent/prompt-studio", label: "Prompt Studio" },
];

export function NavLinks() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const isLinkActive = (href: string) =>
    href === "/agent"
      ? pathname === "/agent" || pathname.startsWith("/agent/calls")
      : pathname.startsWith(href);

  return (
    <>
      {/* Desktop navigation */}
      <nav className="hidden items-center gap-1 sm:flex">
        {links.map((link) => {
          const isActive = isLinkActive(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-ink text-white"
                  : "text-ink-600 hover:bg-ink-100 hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* Mobile hamburger menu */}
      <div className="relative sm:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 rounded-lg border border-ink-200 bg-sand-100 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-sand-200"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            {menuOpen ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            )}
          </svg>
          Nav
        </button>

        {/* Dropdown menu */}
        {menuOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
              onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}
            />
            {/* Menu */}
            <div className="absolute right-0 top-full z-50 mt-2 w-48 rounded-xl border border-ink-200 bg-white py-2 shadow-lg">
              {links.map((link) => {
                const isActive = isLinkActive(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className={`block px-4 py-2.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-ink-100 text-ink"
                        : "text-ink-600 hover:bg-sand-100 hover:text-ink"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}

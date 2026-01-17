"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/customer", label: "Customer" },
  { href: "/agent", label: "Agent" },
  { href: "/agent/prompt-studio", label: "Prompt Studio" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {links.map((link) => {
        const isActive =
          link.href === "/agent"
            ? pathname === "/agent" || pathname.startsWith("/agent/calls")
            : pathname.startsWith(link.href);

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
  );
}

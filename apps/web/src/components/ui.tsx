import { clsx } from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes } from "react";

export const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={clsx(
      "glass-panel rounded-3xl p-6 shadow-soft ring-1 ring-black/5",
      className,
    )}
    {...props}
  />
);

export const Badge = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={clsx(
      "inline-flex items-center rounded-full border border-ink/10 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink/80",
      className,
    )}
    {...props}
  />
);

export const Button = ({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={clsx(
      "inline-flex items-center justify-center rounded-full bg-ink px-4 py-2 text-sm font-semibold text-sand shadow-soft transition hover:-translate-y-0.5 hover:bg-slate disabled:cursor-not-allowed disabled:bg-ink/60",
      className,
    )}
    {...props}
  />
);

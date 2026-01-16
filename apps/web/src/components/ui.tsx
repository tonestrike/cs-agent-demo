import { clsx } from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes } from "react";

export const Card = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={clsx(
      "glass-panel card-sheen rounded-[28px] p-6 shadow-soft ring-1 ring-black/5",
      className,
    )}
    {...props}
  />
);

export const Badge = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={clsx(
      "inline-flex items-center rounded-full border border-ink/15 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-ink/80",
      className,
    )}
    {...props}
  />
);

export const Button = ({
  className,
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) => {
  const needsInkText =
    typeof className === "string" && className.includes("bg-white");
  return (
    <button
      className={clsx(
        "relative inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-sand shadow-soft transition duration-200 hover:-translate-y-0.5 hover:bg-slate hover:shadow-[0_18px_40px_rgba(12,27,31,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 disabled:cursor-not-allowed disabled:bg-ink/60",
        className,
      )}
      style={needsInkText ? { ...style, color: "rgb(12, 27, 31)" } : style}
      {...props}
    />
  );
};

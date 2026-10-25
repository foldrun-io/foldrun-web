// A sentence at the top of a page about what just happened, or what is
// about to: "Payment received", "Top-up cancelled", "Card saved". Three
// billing pages each wrote their own coloured paragraph for this, in three
// slightly different shades; one component keeps the colours meaning one
// thing each.

import type { ReactNode } from "react";

export type BannerTone = "ok" | "warn" | "error" | "info";

const TONES: Record<BannerTone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-800",
  info: "border-line bg-sunken text-gray-800",
};

export function Banner({ tone = "info", children, action, className = "" }: { tone?: BannerTone; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`mb-4 flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${TONES[tone]} ${className}`}>
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

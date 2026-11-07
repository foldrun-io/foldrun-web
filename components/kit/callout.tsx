// A boxed message inside a page (not the full-width Banner under the bar):
// a tone, an icon, a line or a title with a line, and actions. `size="lg"`
// is a moment — "Your first run finished", "The run stopped" — with the
// icon in a filled disc and a bigger title. Server-safe.

import type { ReactNode } from "react";
import { cn } from "./cn";

export type CalloutTone = "good" | "bad" | "warn" | "info" | "neutral";

const BOX: Record<CalloutTone, string> = {
  good: "border-success-line bg-success-soft text-success",
  bad: "border-danger-line bg-danger-soft text-danger",
  warn: "border-warning-line bg-warning-soft text-warning",
  info: "border-info-line bg-info-soft text-info",
  neutral: "border-line bg-surface text-fg",
};
const DISC: Record<CalloutTone, string> = {
  good: "bg-success text-on-ink",
  bad: "bg-danger text-on-ink",
  warn: "bg-warning text-on-ink",
  info: "bg-info text-on-ink",
  neutral: "bg-muted text-fg",
};

export function Callout({
  tone = "neutral",
  icon,
  title,
  children,
  actions,
  size = "md",
  className,
}: {
  tone?: CalloutTone;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  size?: "md" | "lg";
  className?: string;
}) {
  const lg = size === "lg";
  return (
    <section role={tone === "bad" || tone === "warn" ? "alert" : "status"} className={cn("flex min-w-0 gap-3 rounded-lg border text-sm", lg ? "flex-col gap-4 p-5 sm:flex-row sm:items-start" : "flex-wrap items-start px-4 py-3", BOX[tone], className)}>
      {icon &&
        (lg ? (
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5", DISC[tone])}>{icon}</span>
        ) : (
          <span className="mt-0.5 flex shrink-0 [&_svg]:size-4">{icon}</span>
        ))}
      <div className={cn("min-w-0 flex-1", lg && "space-y-3")}>
        {(title || children) && (
          <div className={cn(lg && "space-y-1")}>
            {title && <p className={cn("font-semibold", lg ? "text-lg text-fg" : "")}>{title}</p>}
            {children && <div className={cn("[overflow-wrap:anywhere]", lg && "text-fg-secondary")}>{children}</div>}
          </div>
        )}
        {lg && actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {!lg && actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </section>
  );
}

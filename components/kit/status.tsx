// Status, drawn one way everywhere. The words and their meaning are the
// outcome model's (components/outcome-model.ts, from core): this file only
// draws them — a dot plus its word, never colour alone. No remapping:
// "good" and "done" stay apart, "stopped" is not "failed", "queued" is not
// "needs you".
import * as React from "react";
import { OUTCOME, type Outcome } from "@/components/outcome-model";
import { cn } from "./cn";

export function StatusDot({ outcome, className, label }: { outcome: Outcome; className?: string; label?: string }) {
  const o = OUTCOME[outcome];
  return <span role="img" aria-label={label ?? o.label} title={o.hint} className={cn("inline-block size-2 shrink-0 rounded-full", o.dot, className)} />;
}

/** The dot and its word, for a list cell or a header. */
export function Status({ outcome, className, label }: { outcome: Outcome; className?: string; label?: React.ReactNode }) {
  const o = OUTCOME[outcome];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-fg-secondary", className)} title={o.hint}>
      <StatusDot outcome={outcome} label="" />
      <span>{label ?? o.label}</span>
    </span>
  );
}

/** A plain live/idle/error light for things that are not runs (a workspace,
 *  a connection, a key). */
export type Light = "ok" | "idle" | "warn" | "error" | "busy";
const LIGHT: Record<Light, string> = {
  ok: "bg-emerald-500",
  idle: "bg-gray-400",
  warn: "bg-amber-500",
  error: "bg-red-600",
  busy: "bg-sky-500 animate-pulse",
};
export function Lamp({ light, children, className }: { light: Light; children?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-fg-secondary", className)}>
      <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", LIGHT[light])} />
      {children}
    </span>
  );
}

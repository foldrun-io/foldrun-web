// Status, drawn one way everywhere. The words and their meaning are the
// outcome model's (components/outcome-model.ts, from core): this file only
// draws them — a dot plus its word, never colour alone. No remapping:
// "good" and "done" stay apart, "stopped" is not "failed", "queued" is not
// "needs you".
import * as React from "react";
import { OUTCOME, type Outcome } from "@/components/outcome-model";
import { cn } from "./cn";
import { Tooltip } from "./tooltip";

export function StatusDot({ outcome, className, label }: { outcome: Outcome; className?: string; label?: string }) {
  const o = OUTCOME[outcome];
  const dot = <span role="img" aria-label={label ?? o.label} className={cn("inline-block size-2 shrink-0 rounded-full", o.dot, className)} />;
  // A dot beside its word (label="") needs no hint of its own.
  return label === "" ? dot : <Tooltip label={o.hint}>{dot}</Tooltip>;
}

/** The dot and its word, for a list cell or a header. */
export function Status({ outcome, className, label }: { outcome: Outcome; className?: string; label?: React.ReactNode }) {
  const o = OUTCOME[outcome];
  return (
    <Tooltip label={o.hint}>
      <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-fg-secondary", className)}>
        <StatusDot outcome={outcome} label="" />
        <span>{label ?? o.label}</span>
      </span>
    </Tooltip>
  );
}

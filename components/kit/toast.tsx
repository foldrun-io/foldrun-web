"use client";

// Toast: one short line at the bottom of the screen that says what just
// happened ("Link copied", "Uploading 2 of 5"), announced politely. With
// `onDone` it goes by itself after a moment; without, it stays while the
// caller shows it (a progress line).
import * as React from "react";
import { useEffect } from "react";
import { cn } from "./cn";

export function Toast({ children, onDone, ms = 2600, className }: { children: React.ReactNode; onDone?: () => void; ms?: number; className?: string }) {
  useEffect(() => {
    if (!onDone) return;
    const id = setTimeout(onDone, ms);
    return () => clearTimeout(id);
  }, [children, onDone, ms]);
  return (
    <div
      role="status"
      className={cn("fixed bottom-6 left-1/2 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full bg-ink px-4 py-2 text-sm text-on-ink shadow-menu", className)}
    >
      {children}
    </div>
  );
}

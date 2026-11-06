"use client";

// Tooltip, on Radix: shows on hover and on keyboard focus, never covers the
// control it describes, and is announced as the control's description.
import * as React from "react";
import { Tooltip as T } from "radix-ui";
import { cn } from "./cn";

export const TooltipProvider = T.Provider;

export function Tooltip({
  label,
  children,
  side = "top",
  align = "center",
  delay = 250,
}: {
  label: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  delay?: number;
}) {
  if (label == null || label === "") return children;
  return (
    <T.Root delayDuration={delay}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            "z-[60] max-w-72 rounded-md px-2 py-1 bg-ink text-xs font-medium leading-snug text-on-ink shadow-menu data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        >
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

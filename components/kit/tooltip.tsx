"use client";

// Tooltip, on Radix: shows on hover and on keyboard focus, never covers the
// control it describes, and is announced as the control's description. The
// only hover help in the UI — never the browser's `title=` (owner rule: no
// browser controls). It brings its own provider, so it works on any page.
import * as React from "react";
import { Tooltip as T } from "radix-ui";
import { cn } from "./cn";
import { Button } from "./button";

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
    <T.Provider delayDuration={delay}>
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
    </T.Provider>
  );
}

/** A square, icon-only action with its words on hover and focus: the label
 *  is the accessible name and the tooltip, so a keyboard user gets it too. */
export function IconButton({
  label,
  children,
  tone = "default",
  side = "top",
  size = "icon-xs",
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "children"> & {
  /** What this does, in words. */
  label: string;
  /** The icon. */
  children: React.ReactNode;
  tone?: "default" | "danger";
  side?: "top" | "bottom" | "left" | "right";
  size?: "icon-xs" | "icon-sm" | "icon";
}) {
  return (
    <Tooltip label={label} side={side}>
      <Button
        variant="ghost"
        size={size}
        aria-label={label}
        className={cn("text-fg-muted disabled:opacity-30", tone === "danger" && "hover:bg-danger-soft hover:text-danger", className)}
        {...props}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

"use client";

// Popover, on Radix: a floating panel that a trigger opens — a switcher, a
// small form. Outside click, Escape, focus in and focus back come with it.
// For a list of actions use Menu (menu.tsx); for a blocking question, Dialog.
import * as React from "react";
import { Popover as P } from "radix-ui";
import { cn } from "./cn";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverClose = P.Close;

export function PopoverContent({ className, sideOffset = 6, align = "start", ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "z-50 overflow-hidden rounded-lg border border-line bg-surface text-sm text-fg shadow-menu outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}

"use client";

// Choices, on Radix, drawn in the kit's look instead of the browser's
// (owner rule: no browser controls in the UI):
//
//   Checkbox    one of several independent picks (workspaces, events), or a
//               yes/no that belongs to a form being filled in
//   Switch      an on/off setting that reads as a state ("Published")
//   RadioGroup  one of a few choices shown at once, each with a line of its
//               own; for two or three short words use Segmented instead
//
// Each is a button with the right role (checkbox, switch, radio); inside a
// <label> the label's text toggles it, as a native input's would. With a
// `name` inside a <form>, Radix keeps a hidden input carrying the value.
import * as React from "react";
import { Checkbox as C, RadioGroup as R, Switch as W } from "radix-ui";
import { Check, Minus } from "lucide-react";
import { cn } from "./cn";

export function Checkbox({
  className,
  checked,
  ...props
}: Omit<React.ComponentProps<typeof C.Root>, "checked"> & { checked?: boolean | "indeterminate" }) {
  return (
    <C.Root
      checked={checked}
      className={cn(
        "peer inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-line-strong bg-surface text-on-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-ink data-[state=checked]:bg-ink data-[state=indeterminate]:border-ink data-[state=indeterminate]:bg-ink",
        className,
      )}
      {...props}
    >
      <C.Indicator className="flex items-center justify-center">
        {checked === "indeterminate" ? <Minus className="size-3" strokeWidth={3} aria-hidden /> : <Check className="size-3" strokeWidth={3} aria-hidden />}
      </C.Indicator>
    </C.Root>
  );
}

export function Switch({ className, ...props }: React.ComponentProps<typeof W.Root>) {
  return (
    <W.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-muted-strong p-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-ink",
        className,
      )}
      {...props}
    >
      <W.Thumb className="block size-4 rounded-full bg-surface shadow-sm transition-transform data-[state=checked]:translate-x-4" />
    </W.Root>
  );
}

export function RadioGroup({ className, ...props }: React.ComponentProps<typeof R.Root>) {
  return <R.Root className={cn("grid gap-2", className)} {...props} />;
}

export function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof R.Item>) {
  return (
    <R.Item
      className={cn(
        "peer inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-ink",
        className,
      )}
      {...props}
    >
      <R.Indicator className="size-2 rounded-full bg-ink" />
    </R.Item>
  );
}

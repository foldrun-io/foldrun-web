// Form controls, one spelling each: Input, Textarea, Label and Kbd here;
// Select (select.tsx), Checkbox, Switch, RadioGroup (choice.tsx) and
// Combobox (combobox.tsx) on Radix beside them. A label that is not a <label>
// (a <legend>, a <span> inside a wrapping label) takes `labelClass`.
// Field (page.tsx) puts a label, a control and a hint together.
import * as React from "react";
import { cn } from "./cn";

export const inputBase =
  "w-full min-w-0 rounded-md border border-line bg-surface px-3 text-sm text-fg transition-colors placeholder:text-fg-subtle hover:border-line-strong focus-visible:border-focus focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-soft disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  // A number box has no spinner: the browser draws those, not the kit.
  return <input data-slot="input" type={type} className={cn(inputBase, "h-9 py-1.5", type === "number" && "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(inputBase, "min-h-20 py-2 leading-relaxed", className)} {...props} />;
}

/** A small label over a control in a compact form. */
export const labelClass = "block text-xs font-medium text-fg-muted";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label data-slot="label" className={cn(labelClass, className)} {...props} />;
}

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-sunken px-1 font-sans text-[11px] font-medium text-fg-muted", className)}
      {...props}
    />
  );
}

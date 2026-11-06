import * as React from "react";
import { cn } from "./cn";

export const inputBase =
  "w-full min-w-0 rounded-md border border-line bg-surface px-3 text-sm text-fg transition-colors placeholder:text-fg-subtle hover:border-line-strong focus-visible:border-focus focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-soft disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" type={type} className={cn(inputBase, "h-9 py-1.5", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(inputBase, "min-h-20 py-2 leading-relaxed", className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label data-slot="label" className={cn("text-[13px] font-medium text-fg-secondary", className)} {...props} />;
}

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-sunken px-1 font-sans text-[11px] font-medium text-fg-muted", className)}
      {...props}
    />
  );
}
